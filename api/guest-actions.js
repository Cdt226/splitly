// api/guest-actions.js
// Route pour les actions directes des invités (sans session Supabase Auth)
// Utilise SUPABASE_SERVICE_KEY pour bypasser les RLS

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
      const { error } = await supabaseAdmin.from('expenses').insert({
        event_id: eventId,
        category: data.category,
        sub_category: data.sub,
        detail: data.detail,
        qty: Number(data.qty),
        unit_price: Number(data.unit),
        paid_by: data.paidBy,
        included: data.included,
        comment: data.comment || null,
        is_unpaid: data.is_unpaid || false,
      });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'modify_expense') {
      if (!data.expense_id) return res.status(400).json({ error: 'expense_id manquant' });
      const { error } = await supabaseAdmin.from('expenses').update({
        category: data.category,
        sub_category: data.sub,
        detail: data.detail,
        qty: Number(data.qty),
        unit_price: Number(data.unit),
        paid_by: data.paidBy,
        included: data.included,
        comment: data.comment || null,
      }).eq('id', data.expense_id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'add_cotisation') {
      const montant = Number(data.montant);
      const { error } = await supabaseAdmin.from('cotisations').insert({
        event_id: eventId,
        participant_name: data.participant_name,
        montant,
        forme: data.forme || 'especes',
        statut: montant > 0 ? 'paye' : 'impaye',
        description: data.description || null,
      });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'edit_cotisation') {
      if (!data.cotisation_id) return res.status(400).json({ error: 'cotisation_id manquant' });
      const montant = Number(data.montant);
      const { error } = await supabaseAdmin.from('cotisations').update({
        montant,
        forme: data.forme,
        statut: montant > 0 ? 'paye' : 'impaye',
        description: data.description || null,
      }).eq('id', data.cotisation_id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'add_participant') {
      if (!data.name) return res.status(400).json({ error: 'Nom manquant' });
      const { error } = await supabaseAdmin.from('event_participants').insert({
        event_id: eventId,
        name: data.name,
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
