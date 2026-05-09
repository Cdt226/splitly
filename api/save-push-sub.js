// api/save-push-sub.js
// Sauvegarde l'abonnement push d'un utilisateur dans push_subscriptions

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  const allowedOrigins = ['https://splitmeapp.com', 'https://www.splitmeapp.com'];
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const { userId, guestEmail, subscription } = req.body;
    if (!subscription) return res.status(400).json({ error: 'subscription manquante' });

    // Upsert — remplace si déjà existant pour cet endpoint
    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert({
        user_id: userId || null,
        guest_email: guestEmail || null,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys?.p256dh,
        auth: subscription.keys?.auth,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });

    if (error) {
      console.error('[save-push-sub] POST upsert error:', error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint manquant' });
    const { error } = await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) {
      console.error('[save-push-sub] DELETE error:', error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
}
