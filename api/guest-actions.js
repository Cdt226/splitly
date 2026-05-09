// api/guest-actions.js
// Route pour les actions directes des invités (sans session Supabase Auth)
// Utilise SUPABASE_SERVICE_KEY pour bypasser les RLS

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function validateNum(val, min = 0, max = 999999) {
  const n = Number(val);
  if (isNaN(n) || n < min || n > max) throw new Error(`Valeur numérique invalide : ${val}`);
  return n;
}

function sanitizeStr(val, maxLen = 200) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

export default async function handler(req, res) {
  const allowedOrigins = ['https://splitmeapp.com', 'https://www.splitmeapp.com'];
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const { action, guestEmail, eventId, data } = req.body;
    if (!action || !guestEmail || !eventId) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    // ── Vérifier que l'invité a bien une invitation acceptée sur cet événement ──
    const { data: invitation, error: invErr } = await supabaseAdmin
      .from('invitations')
      .select('permissions, status')
      .eq('email', guestEmail)
      .eq('event_id', eventId)
      .eq('status', 'accepted')
      .single();

    if (invErr || !invitation) {
      return res.status(403).json({ error: 'Invitation non trouvée ou non acceptée' });
    }

    const permissions = invitation.permissions || [];

    // ── Vérifier le droit spécifique selon l'action ──
    const permMap = {
      add_expense:     'add_expense',
      modify_expense:  'edit_expense',
      add_cotisation:  'add_cotisation',
      edit_cotisation: 'edit_cotisation',
      add_participant: 'add_participant',
    };

    const requiredPerm = permMap[action];
    if (requiredPerm && !permissions.includes(requiredPerm)) {
      return res.status(403).json({ error: `Droit manquant : ${requiredPerm}` });
    }

    // ── Exécuter l'action ──────────────────────────────────────

    if (action === 'add_expense') {
      const qty = validateNum(data.qty, 1, 10000);
      const unit_price = validateNum(data.unit, 0.01, 99999);
      const { error } = await supabaseAdmin.from('expenses').insert({
        event_id: eventId,
        category: sanitizeStr(data.category, 50),
        sub_category: sanitizeStr(data.sub, 50),
        detail: sanitizeStr(data.detail, 200),
        qty,
        unit_price,
        paid_by: sanitizeStr(data.paidBy, 60),
        included: Array.isArray(data.included) ? data.included.map(s => sanitizeStr(s, 60)) : [],
        comment: data.comment ? sanitizeStr(data.comment, 500) : null,
        is_unpaid: !!data.is_unpaid,
      });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'modify_expense') {
      if (!data.expense_id) return res.status(400).json({ error: 'expense_id manquant' });
      const qty = validateNum(data.qty, 1, 10000);
      const unit_price = validateNum(data.unit, 0.01, 99999);
      const { error } = await supabaseAdmin.from('expenses').update({
        category: sanitizeStr(data.category, 50),
        sub_category: sanitizeStr(data.sub, 50),
        detail: sanitizeStr(data.detail, 200),
        qty,
        unit_price,
        paid_by: sanitizeStr(data.paidBy, 60),
        included: Array.isArray(data.included) ? data.included.map(s => sanitizeStr(s, 60)) : [],
        comment: data.comment ? sanitizeStr(data.comment, 500) : null,
      }).eq('id', data.expense_id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'add_cotisation') {
      const montant = validateNum(data.montant, 0.01, 999999);
      const { error } = await supabaseAdmin.from('cotisations').insert({
        event_id: eventId,
        participant_name: sanitizeStr(data.participant_name, 60),
        montant,
        forme: ['especes', 'nature'].includes(data.forme) ? data.forme : 'especes',
        statut: 'paye',
        description: data.description ? sanitizeStr(data.description, 500) : null,
      });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'edit_cotisation') {
      if (!data.cotisation_id) return res.status(400).json({ error: 'cotisation_id manquant' });
      const montant = validateNum(data.montant, 0.01, 999999);
      const { error } = await supabaseAdmin.from('cotisations').update({
        montant,
        forme: ['especes', 'nature'].includes(data.forme) ? data.forme : 'especes',
        statut: 'paye',
        description: data.description ? sanitizeStr(data.description, 500) : null,
      }).eq('id', data.cotisation_id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'add_participant') {
      const name = sanitizeStr(data.name, 60);
      if (!name) return res.status(400).json({ error: 'Nom manquant' });
      const { error } = await supabaseAdmin.from('event_participants').insert({
        event_id: eventId,
        name,
      });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: `Action inconnue : ${action}` });

  } catch (err) {
    console.error('Guest actions API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
