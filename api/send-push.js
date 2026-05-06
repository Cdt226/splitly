// api/send-push.js
// Envoie une notification push à un utilisateur ou invité

import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { userId, guestEmail, title, body, url } = req.body;
  if (!title || (!userId && !guestEmail)) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  // Récupérer les abonnements de l'utilisateur
  let query = supabaseAdmin.from('push_subscriptions').select('*');
  if (userId) query = query.eq('user_id', userId);
  else if (guestEmail) query = query.eq('guest_email', guestEmail);

  const { data: subs, error } = await query;
  if (error || !subs?.length) {
    return res.status(200).json({ success: true, sent: 0, message: 'Aucun abonnement trouvé' });
  }

  const payload = JSON.stringify({
    title,
    body,
    url: url || 'https://splitmeapp.com',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  });

  let sent = 0;
  const expired = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent++;
    } catch (err) {
      // Abonnement expiré — supprimer
      if (err.statusCode === 410 || err.statusCode === 404) {
        expired.push(sub.endpoint);
      }
    }
  }

  // Nettoyer les abonnements expirés
  if (expired.length > 0) {
    await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', expired);
  }

  return res.status(200).json({ success: true, sent, expired: expired.length });
}
