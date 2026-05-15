// api/scan-document.js
// Scan inline de document — pré-remplissage du formulaire de charge

import { createClient } from '@supabase/supabase-js';
import { CATEGORIES } from '../src/constants.js';

const SUPABASE_URL = 'https://okwucwvdmdsepqkkmnug.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rd3Vjd3ZkbWRzZXBxa2ttbnVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMzU5NTksImV4cCI6MjA5MjkxMTk1OX0.9p9hdCQWNKCLLNCaxxwE6eJIKntjk-v_d9rMo4Yklhs';

const IMAGE_MIME  = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const ALLOWED_MIME = [...IMAGE_MIME, 'application/pdf'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } },
};

function buildCategoryList() {
  return Object.entries(CATEGORIES)
    .map(([cat, val]) => {
      const subs = val.subs?.length > 0 ? ` (sous-catégories: ${val.subs.join(', ')})` : '';
      return `- "${cat}"${subs}`;
    })
    .join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, contentType } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Fichier manquant' });
  }

  const mime = (contentType || '').toLowerCase();
  if (!ALLOWED_MIME.includes(mime)) {
    return res.status(400).json({ error: 'Format non supporté — utilisez JPEG, PNG, WEBP ou PDF' });
  }

  const bytes = Buffer.from(image, 'base64');
  if (bytes.length > MAX_SIZE_BYTES) {
    return res.status(400).json({ error: 'Fichier trop volumineux (max 10 Mo)' });
  }

  // ── Auth ──────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  const guestEmail = (req.headers['x-guest-email'] || '').trim().toLowerCase();
  const supabase   = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let userId;

  if (guestEmail) {
    const { data: inv } = await supabase
      .from('invitations')
      .select('email')
      .eq('email', guestEmail)
      .eq('status', 'accepted')
      .limit(1)
      .single();
    if (!inv) return res.status(401).json({ error: 'Invité non reconnu' });
    userId = `guest:${guestEmail}`;
  } else {
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Non autorisé' });
    }
    const token = authHeader.slice(7);
    const authedSupa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await authedSupa.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });
    userId = user.id;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Configuration serveur manquante' });
  }

  const categoryList = buildCategoryList();

  const userText = `Analyse ce document et réponds UNIQUEMENT en JSON valide, sans markdown ni commentaire.

Commence par déterminer si ce document contient une ou plusieurs dépenses (reçu, facture, note manuscrite de frais, addition, ticket de caisse, screenshot de paiement, etc.).

Si ce n'est PAS une dépense (photo de nourriture sans prix, document administratif, contrat, etc.), renvoie :
{ "is_expense": false, "reason": "explication courte" }

Si c'est une dépense, renvoie :
{
  "is_expense": true,
  "document_type": "<reçu imprimé|facture|note manuscrite|addition restaurant|screenshot paiement|autre>",
  "amount": <montant total TTC, nombre uniquement>,
  "currency": "<devise ISO: EUR, MAD, XOF, USD...>",
  "category": "<catégorie parmi la liste ci-dessous>",
  "subcategory": "<sous-catégorie correspondante>",
  "detail": "<description courte et claire du contenu>",
  "merchant": "<nom du commerce si lisible, sinon null>",
  "date": "<JJ/MM/AAAA si lisible, sinon null>",
  "items": [{"name": "<article>", "amount": <montant>}],
  "handwritten": <true|false>,
  "confidence": <0 à 1>,
  "unreadable_parts": "<ce qui n'a pas pu être lu, ou null>"
}

Catégories disponibles :
${categoryList}`;

  const contentBlock = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image } }
    : { type: 'image',    source: { type: 'base64', media_type: IMAGE_MIME.includes(mime) ? mime : 'image/jpeg', data: image } };

  try {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), 20000);

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     "Tu es un assistant d'analyse de documents pour une app de gestion de dépenses partagées.",
        messages: [{
          role:    'user',
          content: [contentBlock, { type: 'text', text: userText }],
        }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timerId);

    const data = await apiRes.json();
    if (!apiRes.ok) {
      throw new Error(data.error?.message || `Erreur API Anthropic (${apiRes.status})`);
    }

    const rawText   = data.content?.[0]?.text || '{}';
    const jsonStart = rawText.indexOf('{');
    const jsonEnd   = rawText.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd <= jsonStart) throw new Error('Réponse non structurée');

    let parsed;
    try {
      parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
    } catch {
      throw new Error('Réponse JSON invalide');
    }

    return res.status(200).json(parsed);

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Délai dépassé — réessayez avec une image plus légère' });
    }
    return res.status(500).json({ error: err.message || "Erreur lors de l'analyse" });
  }
}
