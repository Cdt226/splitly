// api/push-subscribe.js
// Vercel Function — Enregistrer un abonnement push
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { subscription, userId } = req.body;
  if (!subscription || !userId) return res.status(400).json({ error: 'Missing fields' });

  // Stocker l'abonnement dans Supabase
  const response = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/push_subscriptions`, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      user_id: userId,
      subscription: JSON.stringify(subscription),
      created_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) return res.status(500).json({ error: 'Failed to store subscription' });
  return res.status(200).json({ success: true });
}
