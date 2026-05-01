// api/send-reminders.js
// Vercel Cron Job — Rappels automatiques aux participants non soldés
// Schedule : tous les lundis à 9h UTC (vercel.json)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Helper : requête Supabase via REST API
async function sbFetch(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase error on ${table}: ${res.status}`);
  return res.json();
}

// Helper : envoyer un email via Resend
async function sendEmail(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "SplitLy <noreply@splitmeapp.com>",
      to,
      subject,
      html,
    }),
  });
  return res.ok;
}

export default async function handler(req, res) {
  // Sécurité : vérifier le CRON_SECRET
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Récupérer les événements ouverts avec leurs participants
    const events = await sbFetch(
      "events",
      "?status=eq.open&select=id,name,date,currency,admin_id"
    );

    if (!events || events.length === 0) {
      return res.status(200).json({ message: "Aucun événement ouvert", sent: 0 });
    }

    let remindersSent = 0;

    for (const ev of events) {
      const sym = ev.currency?.split(" ")[1] || "€";
      const fmt = (n) => `${Number(n).toFixed(2)} ${sym}`;

      // Charges de cet événement
      const expenses = await sbFetch(
        "expenses",
        `?event_id=eq.${ev.id}&is_unpaid=eq.false`
      );
      if (!expenses || expenses.length === 0) continue;

      // Participants
      const participants = await sbFetch(
        "event_participants",
        `?event_id=eq.${ev.id}&select=name`
      );
      if (!participants || participants.length === 0) continue;

      // Contributions
      const contributions = await sbFetch(
        "contributions",
        `?event_id=eq.${ev.id}`
      );
      const contribMap = {};
      (contributions || []).forEach(c => { contribMap[c.participant] = c.amount; });

      // Calculer les débiteurs
      const debtors = [];
      for (const { name } of participants) {
        const owed = expenses.reduce((sum, ex) => {
          const inc = ex.included || [];
          if (!inc.includes(name)) return sum;
          return sum + (ex.qty * (ex.unit_price ?? 0)) / inc.length;
        }, 0);
        const paid = contribMap[name] || 0;
        const net = paid - owed;
        if (net < -1) {
          debtors.push({ name, owes: Math.abs(net), owed });
        }
      }

      if (debtors.length === 0) continue;

      // Email admin
      const adminUser = await sbFetch(
        "auth_users_view",
        `?id=eq.${ev.admin_id}&select=email`
      ).catch(() => null);

      // Utiliser les invitations pour trouver les emails
      const invitations = await sbFetch(
        "invitations",
        `?event_id=eq.${ev.id}&select=email,role`
      );

      const debtorsList = debtors
        .map(d => `<li><strong>${d.name}</strong> — reste <strong style="color:#C62828">${fmt(d.owes)}</strong> à payer</li>`)
        .join("");

      // Email récap à l'admin si on a son email via les invitations ou autre
      if (adminUser?.[0]?.email) {
        const sent = await sendEmail(
          adminUser[0].email,
          `📊 Rappel SplitLy — ${ev.name}`,
          `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:40px 32px">
            <div style="font-size:26px;font-weight:700;margin-bottom:6px">SplitLy</div>
            <div style="font-size:12px;color:#aaa;margin-bottom:28px">Rappel automatique hebdomadaire</div>
            <h2 style="font-size:18px;margin-bottom:8px">📊 ${ev.name}</h2>
            <p style="font-size:14px;color:#555;margin-bottom:16px">${debtors.length} participant(s) doivent encore rembourser :</p>
            <ul style="font-size:14px;line-height:2;margin-bottom:24px">${debtorsList}</ul>
            <a href="https://splitmeapp.com" style="display:inline-block;background:#0F0F0F;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">
              Voir la répartition →
            </a>
            <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#ccc">
              SplitLy · splitmeapp.com · Rappel automatique chaque lundi
            </div>
          </div>`
        );
        if (sent) remindersSent++;
      }

      // Emails aux invités débiteurs
      for (const inv of (invitations || [])) {
        const match = debtors.find(d =>
          inv.email.toLowerCase().includes(d.name.toLowerCase()) ||
          d.name.toLowerCase().includes(inv.email.split("@")[0].toLowerCase())
        );
        if (!match) continue;

        const sent = await sendEmail(
          inv.email,
          `💸 Rappel — ${fmt(match.owes)} restants pour ${ev.name}`,
          `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:40px 32px">
            <div style="font-size:26px;font-weight:700;margin-bottom:28px">SplitLy</div>
            <p style="font-size:15px;margin-bottom:12px">Bonjour <strong>${match.name}</strong>,</p>
            <p style="font-size:14px;color:#555;line-height:1.6;margin-bottom:20px">
              Pour l'événement <strong>${ev.name}</strong>, il te reste
              <strong style="color:#C62828"> ${fmt(match.owes)}</strong> à rembourser
              (sur une part totale de ${fmt(match.owed)}).
            </p>
            <div style="background:#FFF8E1;border-radius:10px;padding:14px;margin-bottom:24px;font-size:14px;color:#E65100">
              💡 Contacte l'organisateur pour procéder au remboursement.
            </div>
            <a href="https://splitmeapp.com" style="display:inline-block;background:#0F0F0F;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">
              Voir mes soldes →
            </a>
            <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#ccc">
              SplitLy · splitmeapp.com
            </div>
          </div>`
        );
        if (sent) remindersSent++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `${remindersSent} rappel(s) envoyé(s)`,
      sent: remindersSent,
    });

  } catch (err) {
    console.error("Erreur cron:", err);
    return res.status(500).json({ error: err.message });
  }
}
