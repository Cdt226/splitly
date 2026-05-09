// api/send-reminder-event.js
// Manual reminder trigger — called from Balance.jsx by the event admin.
// Authenticates via Supabase JWT, verifies admin ownership, sends emails to debtors.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

async function sbFetch(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase error on ${table}: ${res.status}`);
  return res.json();
}

async function getUserFromToken(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function sendEmail(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: "SplitLy <noreply@splitmeapp.com>", to, subject, html }),
  });
  return res.ok;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing authorization token" });

  const user = await getUserFromToken(token);
  if (!user?.id) return res.status(401).json({ error: "Invalid token" });

  const { eventId } = req.body;
  if (!eventId) return res.status(400).json({ error: "eventId required" });

  try {
    // Verify user is admin of this event
    const events = await sbFetch("events", `?id=eq.${eventId}&admin_id=eq.${user.id}&select=id,name,date,currency`);
    if (!events || events.length === 0) return res.status(403).json({ error: "Forbidden" });
    const ev = events[0];
    const sym = ev.currency?.split(" ")[1] || "€";
    const fmt = (n) => `${Number(n).toFixed(2)} ${sym}`;

    const expenses = await sbFetch("expenses", `?event_id=eq.${eventId}&is_unpaid=eq.false`);
    if (!expenses || expenses.length === 0) return res.status(200).json({ sent: 0, message: "no_expenses" });

    const participants = await sbFetch("event_participants", `?event_id=eq.${eventId}&select=name`);
    if (!participants || participants.length === 0) return res.status(200).json({ sent: 0, message: "no_participants" });

    const contributions = await sbFetch("contributions", `?event_id=eq.${eventId}`);
    const contribMap = {};
    (contributions || []).forEach(c => { contribMap[c.participant] = c.amount; });

    // Compute debtors
    const debtors = [];
    for (const { name } of participants) {
      const owed = expenses.reduce((sum, ex) => {
        const inc = ex.included || [];
        if (!inc.includes(name)) return sum;
        return sum + (ex.qty * (ex.unit_price ?? 0)) / inc.length;
      }, 0);
      const paid = contribMap[name] || 0;
      const net = paid - owed;
      if (net < -1) debtors.push({ name, owes: Math.abs(net) });
    }

    if (debtors.length === 0) return res.status(200).json({ sent: 0, message: "all_settled" });

    // Get invitations to find debtor emails
    const invitations = await sbFetch("invitations", `?event_id=eq.${eventId}&select=email`);
    let sent = 0;

    for (const inv of (invitations || [])) {
      const emailLocal = inv.email.split("@")[0].toLowerCase().replace(/[._-]/g, " ");
      const match = debtors.find(d => {
        const nameLower = d.name.toLowerCase();
        return nameLower === emailLocal ||
          emailLocal.includes(nameLower) ||
          nameLower.split(" ").some(part => part.length > 2 && emailLocal.includes(part));
      });
      if (!match) continue;

      const ok = await sendEmail(
        inv.email,
        `💸 Rappel SplitLy — ${fmt(match.owes)} restants pour ${ev.name}`,
        `<!DOCTYPE html><html><body>
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:40px 24px">
          <div style="background:#0F0F0F;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
            <div style="font-size:22px;font-weight:900;color:#fff">SplitLy</div>
          </div>
          <div style="background:#fff;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;padding:28px 24px">
            <p style="font-size:15px;margin:0 0 12px">Bonjour <strong>${match.name}</strong>,</p>
            <p style="font-size:14px;color:#555;line-height:1.6;margin:0 0 20px">
              Pour l'événement <strong>${ev.name}</strong>, il te reste
              <strong style="color:#C62828;font-size:16px"> ${fmt(match.owes)}</strong> à rembourser.
            </p>
            <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:10px;padding:14px 16px;margin-bottom:24px;font-size:13px;color:#E65100">
              💡 Contacte l'organisateur pour procéder au remboursement.
            </div>
            <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#ccc;text-align:center">
              SplitLy · splitmeapp.com
            </div>
          </div>
        </div>
        </body></html>`
      );
      if (ok) sent++;
    }

    return res.status(200).json({ success: true, sent, debtors: debtors.length });
  } catch (err) {
    console.error("send-reminder-event error:", err);
    return res.status(500).json({ error: err.message });
  }
}
