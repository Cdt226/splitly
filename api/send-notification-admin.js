// api/send-notification-admin.js
// Vercel Serverless Function — envoie un email à l'admin lors d'une demande de permission invité

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://okwucwvdmdsepqkkmnug.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { adminId, eventId, guestEmail, eventName, requestedPermissions } = req.body || {};
  if (!adminId || !guestEmail || !eventName) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Insérer la notification persistante pour l'admin (service role bypasse les RLS)
    await supabase.from('notifications').insert({
      user_id: adminId,
      event_id: eventId || null,
      type: 'request',
      message: `${guestEmail} demande des droits supplémentaires sur "${eventName}"`,
    });

    // Récupérer l'email de l'admin
    const { data: { user: adminUser }, error: userErr } = await supabase.auth.admin.getUserById(adminId);
    if (userErr || !adminUser?.email) {
      return res.status(404).json({ error: 'Admin introuvable' });
    }
    const adminEmail = adminUser.email;

    // Vérifier que l'admin n'a pas désactivé les emails
    const { data: unsub } = await supabase
      .from('email_unsubscribes')
      .select('email')
      .eq('email', adminEmail)
      .maybeSingle();
    if (unsub) return res.status(200).json({ skipped: true, reason: 'unsubscribed' });

    const permLabels = {
      add_expense: 'Ajouter charge', edit_expense: 'Modifier charge',
      delete_expense: 'Supprimer charge', add_participant: 'Ajouter participant',
      remove_participant: 'Supprimer participant', add_cotisation: 'Ajouter cotisation',
      edit_cotisation: 'Modifier cotisation', export_pdf: 'Exporter PDF',
    };
    const permList = (requestedPermissions || [])
      .map(p => permLabels[p] || p)
      .join(', ') || 'Aucun';

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:32px">
        <h2 style="font-size:22px;margin-bottom:8px">🔐 Demande de droits</h2>
        <p style="color:#555;margin-bottom:20px">
          L'invité <strong>${guestEmail}</strong> a demandé des droits supplémentaires
          sur l'événement <strong>${eventName}</strong>.
        </p>
        <div style="background:#f5f5f5;border-radius:10px;padding:16px;margin-bottom:20px">
          <strong>Droits demandés :</strong> ${permList}
        </div>
        <p style="color:#888;font-size:12px">Connectez-vous à SplitLy → Notifications pour approuver ou refuser.</p>
      </div>
    `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SplitLy <noreply@splitmeapp.com>',
        to: adminEmail,
        subject: `🔐 ${guestEmail} demande des droits sur "${eventName}"`,
        html,
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
