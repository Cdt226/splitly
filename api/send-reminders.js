// api/send-reminders.js
// Vercel Cron Job — Rappels automatiques aux participants non soldés
// Exécuté tous les lundis à 9h00 (UTC)
// Config dans vercel.json : { "crons": [{ "path": "/api/send-reminders", "schedule": "0 9 * * 1" }] }

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Clé service (pas la clé anon) — à ajouter dans Vercel env vars
);

export default async function handler(req, res) {
  // Sécurité : vérifier que c'est bien Vercel Cron qui appelle
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Récupérer tous les événements ouverts
    const { data: events, error: evErr } = await supabase
      .from('events')
      .select('*, event_participants(name)')
      .eq('status', 'open');

    if (evErr) throw evErr;
    if (!events || events.length === 0) {
      return res.status(200).json({ message: 'Aucun événement ouvert', sent: 0 });
    }

    let remindersSent = 0;

    for (const ev of events) {
      // 2. Récupérer les charges et contributions
      const { data: expenses } = await supabase
        .from('expenses')
        .select('*')
        .eq('event_id', ev.id);

      const { data: contributions } = await supabase
        .from('contributions')
        .select('*')
        .eq('event_id', ev.id);

      if (!expenses || expenses.length === 0) continue;

      const contribMap = {};
      (contributions || []).forEach(c => { contribMap[c.participant] = c.amount; });

      const participants = (ev.event_participants || []).map(p => p.name);

      // 3. Calculer qui doit encore de l'argent
      const debtors = [];
      for (const participant of participants) {
        const owed = expenses.reduce((sum, ex) => {
          const inc = ex.included || [];
          if (!inc.includes(participant)) return sum;
          return sum + (ex.qty * (ex.unit_price ?? 0)) / inc.length;
        }, 0);
        const paid = contribMap[participant] || 0;
        const net = paid - owed;
        if (net < -1) { // Doit encore plus de 1 unité
          debtors.push({ name: participant, owes: Math.abs(net), owed });
        }
      }

      if (debtors.length === 0) continue;

      // 4. Trouver les invités avec email pour cet événement
      const { data: invitations } = await supabase
        .from('invitations')
        .select('email')
        .eq('event_id', ev.id);

      if (!invitations || invitations.length === 0) continue;

      const sym = ev.currency?.split(' ')[1] || '€';
      const fmt = (n) => `${Number(n).toFixed(2)} ${sym}`;

      // 5. Envoyer un rappel à l'admin de l'événement
      const { data: admin } = await supabase
        .from('users')
        .select('email')
        .eq('id', ev.admin_id)
        .single();

      const debtorsList = debtors.map(d => `<li><strong>${d.name}</strong> doit encore <strong>${fmt(d.owes)}</strong></li>`).join('');

      if (admin?.email) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'SplitLy <noreply@splitmeapp.com>',
            to: admin.email,
            subject: `📊 Rappel SplitLy — ${ev.name}`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:40px 32px;background:#fff">
                <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#0F0F0F;margin-bottom:6px">SplitLy</div>
                <div style="font-size:12px;color:#aaa;margin-bottom:28px">Rappel automatique hebdomadaire</div>
                
                <h2 style="font-size:18px;color:#0F0F0F;margin-bottom:8px">📊 ${ev.name}</h2>
                <p style="font-size:14px;color:#555;margin-bottom:20px">
                  ${debtors.length} participant(s) n'ont pas encore soldé leur part :
                </p>
                
                <ul style="font-size:14px;color:#333;line-height:2;padding-left:20px;margin-bottom:24px">
                  ${debtorsList}
                </ul>
                
                <a href="https://splitmeapp.com" style="display:inline-block;background:#0F0F0F;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">
                  Voir la répartition →
                </a>
                
                <div style="margin-top:32px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#ccc">
                  SplitLy · splitmeapp.com · Rappel automatique envoyé chaque lundi
                </div>
              </div>
            `,
          }),
        });
        remindersSent++;
      }

      // 6. Envoyer un rappel personnalisé aux invités débiteurs
      for (const inv of invitations) {
        const matchingDebtor = debtors.find(d =>
          inv.email.toLowerCase().includes(d.name.toLowerCase()) ||
          d.name.toLowerCase().includes(inv.email.split('@')[0].toLowerCase())
        );

        if (matchingDebtor) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'SplitLy <noreply@splitmeapp.com>',
              to: inv.email,
              subject: `💸 Rappel — Tu dois encore ${fmt(matchingDebtor.owes)} pour ${ev.name}`,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:40px 32px;background:#fff">
                  <div style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#0F0F0F;margin-bottom:28px">SplitLy</div>
                  
                  <p style="font-size:15px;color:#333;margin-bottom:16px">Bonjour,</p>
                  <p style="font-size:14px;color:#555;line-height:1.6;margin-bottom:20px">
                    Un petit rappel pour l'événement <strong>${ev.name}</strong>.<br>
                    Ta part due est de <strong>${fmt(matchingDebtor.owed)}</strong> et il te reste encore <strong style="color:#C62828">${fmt(matchingDebtor.owes)}</strong> à rembourser.
                  </p>
                  
                  <div style="background:#FFF8E1;border-radius:10px;padding:16px;margin-bottom:24px;font-size:14px;color:#E65100">
                    💡 Contacte l'organisateur pour procéder au remboursement.
                  </div>
                  
                  <a href="https://splitmeapp.com" style="display:inline-block;background:#0F0F0F;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">
                    Voir mes soldes →
                  </a>
                  
                  <div style="margin-top:32px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#ccc">
                    SplitLy · splitmeapp.com · Rappel automatique
                  </div>
                </div>
              `,
            }),
          });
          remindersSent++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `${remindersSent} rappel(s) envoyé(s)`,
      sent: remindersSent,
    });

  } catch (err) {
    console.error('Erreur cron send-reminders:', err);
    return res.status(500).json({ error: err.message });
  }
}
