// api/admin-users.js
// Route protégée — Super Admin uniquement
// Utilise SUPABASE_SERVICE_KEY pour accéder à auth.users côté serveur

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────
  const allowedOrigins = ['https://splitmeapp.com', 'https://www.splitmeapp.com'];
  const origin = req.headers.origin;
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Vérifier les variables d'environnement ────────────────
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables environnement manquantes (VITE_SUPABASE_URL ou SUPABASE_SERVICE_KEY)' });
  }

  try {
    // ── Vérifier que l'appelant est admin ──────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    const token = authHeader.split(' ')[1];

    // Vérifier le token JWT via Supabase
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !caller) return res.status(401).json({ error: 'Token invalide' });

    // Vérifier le rôle admin dans profiles
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('user_role')
      .eq('id', caller.id)
      .single();

    if (callerProfile?.user_role !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé — droits insuffisants' });
    }

    // ── GET — routes spécialisées ────────────────────────
    if (req.method === 'GET') {
      const type = req.query?.type;

      if (type === 'reports') {
        const { data: reports } = await supabaseAdmin
          .from('reports')
          .select('*')
          .order('created_at', { ascending: false });
        return res.status(200).json({ reports: reports || [] });
      }

      if (type === 'ocr') {
        const { data: ocrData } = await supabaseAdmin
          .from('ocr_logs')
          .select('user_id, success, level_rejected, classification_method, created_at')
          .order('created_at', { ascending: false })
          .limit(5000);
        return res.status(200).json({ ocr_logs: ocrData || [] });
      }

      // ── liste des utilisateurs (défaut) ───────────────
      const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (usersError) throw usersError;

      // Récupérer tous les profils
      const { data: profiles } = await supabaseAdmin.from('profiles').select('*');
      const profileMap = {};
      (profiles || []).forEach(p => { profileMap[p.id] = p; });

      // Récupérer stats événements par user
      const { data: events } = await supabaseAdmin
        .from('events')
        .select('admin_id, id, status');

      // Récupérer stats charges par event
      const { data: expenses } = await supabaseAdmin
        .from('expenses')
        .select('event_id, qty, unit_price');

      // Indexer events par admin
      const eventsByUser = {};
      (events || []).forEach(ev => {
        if (!eventsByUser[ev.admin_id]) eventsByUser[ev.admin_id] = [];
        eventsByUser[ev.admin_id].push(ev);
      });

      // Indexer expenses par event
      const expensesByEvent = {};
      (expenses || []).forEach(ex => {
        if (!expensesByEvent[ex.event_id]) expensesByEvent[ex.event_id] = [];
        expensesByEvent[ex.event_id].push(ex);
      });

      // Construire la réponse enrichie
      const enriched = users.map(u => {
        const profile = profileMap[u.id] || {};
        const userEvents = eventsByUser[u.id] || [];
        const openEvents = userEvents.filter(e => e.status === 'open').length;
        const closedEvents = userEvents.filter(e => e.status === 'closed').length;
        const totalExpenses = userEvents.reduce((sum, ev) => {
          return sum + (expensesByEvent[ev.id] || []).length;
        }, 0);
        const totalBudget = userEvents.reduce((sum, ev) => {
          return sum + (expensesByEvent[ev.id] || []).reduce((s, ex) => s + (ex.qty * (ex.unit_price ?? 0)), 0);
        }, 0);

        return {
          id: u.id,
          email: u.email,
          full_name: profile.full_name || u.user_metadata?.full_name || '—',
          user_role: profile.user_role || 'user',
          created_at: u.created_at,
          last_sign_in: u.last_sign_in_at,
          confirmed: !!u.confirmed_at,
          events_total: userEvents.length,
          events_open: openEvents,
          events_closed: closedEvents,
          expenses_total: totalExpenses,
          budget_total: totalBudget,
        };
      });

      return res.status(200).json({ users: enriched });
    }

    // ── POST — actions admin (bloquer / débloquer / supprimer) ──
    if (req.method === 'POST') {
      const { action, userId } = req.body;
      if (!action || !userId) return res.status(400).json({ error: 'Paramètres manquants' });

      // Empêcher de s'auto-modifier
      if (userId === caller.id) {
        return res.status(400).json({ error: 'Impossible de modifier votre propre compte' });
      }

      if (action === 'block') {
        await supabaseAdmin.from('profiles').update({ user_role: 'blocked' }).eq('id', userId);
        // Révoquer les sessions actives
        await supabaseAdmin.auth.admin.signOut(userId, 'global');
        return res.status(200).json({ success: true, message: 'Compte bloqué' });
      }

      if (action === 'unblock') {
        await supabaseAdmin.from('profiles').update({ user_role: 'user' }).eq('id', userId);
        return res.status(200).json({ success: true, message: 'Compte débloqué' });
      }

      if (action === 'delete') {
        // Supprimer les données utilisateur
        const userEvents = (eventsByUser?.[userId] || []).map(e => e.id);
        if (userEvents.length > 0) {
          await supabaseAdmin.from('expenses').delete().in('event_id', userEvents);
          await supabaseAdmin.from('contributions').delete().in('event_id', userEvents);
          await supabaseAdmin.from('event_participants').delete().in('event_id', userEvents);
          await supabaseAdmin.from('events').delete().eq('admin_id', userId);
        }
        await supabaseAdmin.from('profiles').delete().eq('id', userId);
        await supabaseAdmin.auth.admin.deleteUser(userId);
        return res.status(200).json({ success: true, message: 'Compte supprimé' });
      }

      if (action === 'update_report') {
        const { reportId, status } = req.body;
        if (!reportId || !status) return res.status(400).json({ error: 'Paramètres manquants' });
        await supabaseAdmin.from('reports').update({ status }).eq('id', reportId);
        return res.status(200).json({ success: true, message: `Signalement ${status}` });
      }

      return res.status(400).json({ error: 'Action inconnue' });
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });

  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
