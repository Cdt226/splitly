// api/send-broadcast.js
// Vercel Serverless Function — Email groupé, réservé au super admin

import { createClient } from '@supabase/supabase-js';

const BROADCAST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables environnement manquantes' });
  }

  // ── Auth ────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non autorisé' });
  const token = authHeader.split(' ')[1];

  const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !caller) return res.status(401).json({ error: 'Token invalide' });

  const { data: callerProfile } = await supabaseAdmin
    .from('profiles')
    .select('user_role')
    .eq('id', caller.id)
    .single();

  if (callerProfile?.user_role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé — droits insuffisants' });
  }

  const { subject, body } = req.body;
  if (!subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'Sujet et message requis' });
  }

  // ── Rate limit ──────────────────────────────────────────
  const { data: lastLog } = await supabaseAdmin
    .from('broadcast_logs')
    .select('sent_at')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (lastLog) {
    const elapsed = Date.now() - new Date(lastLog.sent_at).getTime();
    if (elapsed < BROADCAST_COOLDOWN_MS) {
      const nextAllowed = new Date(new Date(lastLog.sent_at).getTime() + BROADCAST_COOLDOWN_MS);
      return res.status(429).json({ error: 'Limite de fréquence atteinte', nextAllowed: nextAllowed.toISOString() });
    }
  }

  // ── Destinataires ───────────────────────────────────────
  const { data: unsubs } = await supabaseAdmin
    .from('email_unsubscribes')
    .select('email');
  const unsubSet = new Set((unsubs || []).map(u => u.email));

  const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const recipients = (authUsers || [])
    .filter(u => u.email && !unsubSet.has(u.email))
    .map(u => u.email);

  if (!recipients.length) return res.status(200).json({ success: true, sent: 0 });

  // ── Envoi via Resend (BCC) ──────────────────────────────
  const html = `<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:32px">
    <h2 style="color:#0F0F0F">Message de l'équipe SplitLy</h2>
    <div style="font-size:15px;line-height:1.7;color:#333;white-space:pre-wrap">${body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
    <p style="font-size:11px;color:#aaa;text-align:center">
      Vous recevez cet email car vous êtes inscrit sur SplitLy.<br>
      Pour vous désabonner de ces communications, rendez-vous dans vos paramètres.
    </p>
  </div>`;

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'SplitLy <noreply@splitmeapp.com>',
      to: 'noreply@splitmeapp.com',
      bcc: recipients,
      subject,
      html,
    }),
  });

  if (!sendRes.ok) {
    const err = await sendRes.json();
    return res.status(500).json({ error: err });
  }

  // ── Log ─────────────────────────────────────────────────
  await supabaseAdmin.from('broadcast_logs').insert({
    sent_by: caller.id,
    subject,
    recipient_count: recipients.length,
    sent_at: new Date().toISOString(),
  });

  return res.status(200).json({ success: true, sent: recipients.length });
}
