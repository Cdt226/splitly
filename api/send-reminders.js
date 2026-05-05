// api/send-reminders.js
// Vercel Cron Job — Rappels automatiques aux participants non soldés
// Schedule : tous les lundis à 9h UTC (vercel.json)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

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
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
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

      const expenses = await sbFetch(
        "expenses",
        `?event_id=eq.${ev.id}&is_unpaid=eq.false`
      );
      if (!expenses || expenses.length === 0) continue;

      const participants = await sbFetch(
        "event_participants",
        `?event_id=eq.${ev.id}&select=name`
      );
      if (!participants || participants.length === 0) continue;

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
        if (net < -1) debtors.push({ name, owes: Math.abs(net), owed });
      }

      if (debtors.length === 0) continue;

      const debtorsList = debtors
        .map(d => `<li><strong>${d.name}</strong> — reste <strong style="color:#C62828">${fmt(d.owes)}</strong> à régler</li>`)
        .join("");

      // Email admin — via table profiles (email disponible)
      const adminProfiles = await sbFetch(
        "profiles",
        `?id=eq.${ev.admin_id}&select=email,full_name`
      ).catch(() => []);

      const adminEmail = adminProfiles?.[0]?.email;
      const adminName = adminProfiles?.[0]?.full_name || "Admin";

      if (adminEmail) {
        const sent = await sendEmail(
          adminEmail,
          `📊 Rappel SplitLy — ${ev.name}`,
          `<!DOCTYPE html><html><body>
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:40px 24px">
            <div style="background:#0F0F0F;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
              <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px">SplitLy</div>
              <div style="font-size:11px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:1px">Rappel automatique hebdomadaire</div>
            </div>
            <div style="background:#fff;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;padding:28px 24px">
              <p style="font-size:15px;margin:0 0 8px">Bonjour <strong>${adminName}</strong>,</p>
              <p style="font-size:14px;color:#555;margin:0 0 20px;line-height:1.6">
                L'événement <strong>${ev.name}</strong> a encore <strong>${debtors.length}</strong> participant(s) qui n'ont pas soldé leur part :
              </p>
              <ul style="font-size:14px;line-height:2;margin:0 0 24px;padding-left:20px">${debtorsList}</ul>
              <div style="text-align:center">
                <a href="https://splitmeapp.com" style="display:inline-block;background:#0F0F0F;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:700">
                  Voir la répartition →
                </a>
              </div>
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#ccc;text-align:center">
                SplitLy · splitmeapp.com · Rappel chaque lundi à 9h
              </div>
            </div>
          </div>
          </body></html>`
        );
        if (sent) remindersSent++;
      }

      // Emails aux invités débiteurs
      // On récupère les invitations acceptées pour cet événement
      const invitations = await sbFetch(
        "invitations",
        `?event_id=eq.${ev.id}&status=eq.accepted&select=email`
      );

      for (const inv of (invitations || [])) {
        // Chercher le débiteur correspondant à cet email
        // On compare les noms des participants avec la partie locale de l'email
        const emailLocal = inv.email.split("@")[0].toLowerCase().replace(/[._-]/g, " ");
        const match = debtors.find(d => {
          const nameLower = d.name.toLowerCase();
          return nameLower === emailLocal ||
            emailLocal.includes(nameLower) ||
            nameLower.split(" ").some(part => part.length > 2 && emailLocal.includes(part));
        });
        if (!match) continue;

        const sent = await sendEmail(
          inv.email,
          `💸 Rappel — ${fmt(match.owes)} restants pour ${ev.name}`,
          `<!DOCTYPE html><html><body>
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:40px 24px">
            <div style="background:#0F0F0F;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
              <div style="font-size:22px;font-weight:900;color:#fff">SplitLy</div>
            </div>
            <div style="background:#fff;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;padding:28px 24px">
              <p style="font-size:15px;margin:0 0 12px">Bonjour <strong>${match.name}</strong>,</p>
              <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 20px">
                Pour l'événement <strong>${ev.name}</strong>, il te reste
                <strong style="color:#C62828;font-size:16px"> ${fmt(match.owes)}</strong> à rembourser
                (sur une part totale de ${fmt(match.owed)}).
              </p>
              <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:10px;padding:14px 16px;margin-bottom:24px;font-size:13px;color:#E65100">
                💡 Contacte l'organisateur pour procéder au remboursement.
              </div>
              <div style="text-align:center">
                <a href="https://splitmeapp.com" style="display:inline-block;background:#0F0F0F;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:700">
                  Voir mes soldes →
                </a>
              </div>
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#ccc;text-align:center">
                SplitLy · splitmeapp.com
              </div>
            </div>
          </div>
          </body></html>`
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
