// api/scan-receipt.js
// Vercel Serverless Function — Pipeline OCR 4 niveaux

import { createClient } from '@supabase/supabase-js';
import { CATEGORIES } from '../src/constants.js';

const SUPABASE_URL = 'https://okwucwvdmdsepqkkmnug.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rd3Vjd3ZkbWRzZXBxa2ttbnVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMzU5NTksImV4cCI6MjA5MjkxMTk1OX0.9p9hdCQWNKCLLNCaxxwE6eJIKntjk-v_d9rMo4Yklhs';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_SIZE_BYTES = 4 * 1024 * 1024;
const RATE_LIMIT = 20;

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

// ─── Magic bytes detection ────────────────────────────────────
function detectMimeFromBytes(base64) {
  const buf = Buffer.from(base64.slice(0, 24), 'base64');
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  // HEIC: ftyp box at offset 4
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'image/heic';
  return null;
}

// ─── Logger ───────────────────────────────────────────────────
async function logOCR(client, userId, success, errorReason, levelRejected, classificationMethod = null) {
  try {
    await client.from('ocr_logs').insert({
      user_id: userId,
      success,
      error_reason: errorReason ?? null,
      level_rejected: levelRejected ?? null,
      classification_method: classificationMethod ?? null,
    });
  } catch {}
}

// ─── Promise.race timeout (15s pour les classifieurs) ────────
function withTimeout(promise, ms = 15000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout (${ms}ms)`)), ms)
  );
  return Promise.race([promise, timeout]);
}

// ─── Construction dynamique du prompt catégories ─────────────
function buildCategoryPrompt() {
  return Object.entries(CATEGORIES)
    .map(([cat, val]) => {
      const subs = val.subs && val.subs.length > 0
        ? ` (sous-catégories: ${val.subs.join(', ')})`
        : '';
      return `- "${cat}"${subs}`;
    })
    .join('\n');
}

// ─── Catégorisation depuis les labels Google Vision ───────────
function categorizeFromGoogleLabels(labels, merchantName) {
  const labelMap = {
    food: 'Nourriture', restaurant: 'Nourriture', meal: 'Nourriture',
    dish: 'Nourriture', cuisine: 'Nourriture', menu: 'Nourriture',
    drink: 'Boisson', beverage: 'Boisson', coffee: 'Boisson',
    tea: 'Boisson', juice: 'Boisson',
    taxi: 'Transport', car: 'Transport', vehicle: 'Transport',
    fuel: 'Transport', ticket: 'Transport', parking: 'Transport',
    hotel: 'Hébergement', room: 'Hébergement',
    accommodation: 'Hébergement', lodging: 'Hébergement',
    supermarket: 'Courses & Épicerie', grocery: 'Courses & Épicerie',
    market: 'Courses & Épicerie', store: 'Courses & Épicerie',
    pharmacy: 'Santé & Bien-être', medicine: 'Santé & Bien-être',
    health: 'Santé & Bien-être', medical: 'Santé & Bien-être',
    cinema: 'Loisirs & Activités', entertainment: 'Loisirs & Activités',
    sport: 'Loisirs & Activités', museum: 'Loisirs & Activités',
    technology: 'Technologie & Services', electronics: 'Technologie & Services',
    software: 'Technologie & Services',
    electricity: 'Loyer & Factures', utility: 'Loyer & Factures',
    internet: 'Loyer & Factures', bill: 'Loyer & Factures',
  };

  for (const label of (labels || [])) {
    const labelLower = (label.description || '').toLowerCase();
    if (labelMap[labelLower]) {
      const cat = labelMap[labelLower];
      const subs = CATEGORIES[cat]?.subs || [];
      return { category: cat, subcategory: subs[0] || 'Autre', categoryConfidence: 0.6, categoryMethod: 'google_labels' };
    }
  }
  return categorizeFromMerchantName(merchantName);
}

// ─── Catégorisation heuristique depuis le nom du marchand ─────
function categorizeFromMerchantName(merchantName) {
  if (!merchantName) {
    return { category: 'Autre', subcategory: 'Autre', categoryConfidence: 0.1, categoryMethod: 'heuristic_none' };
  }
  const name = merchantName.toLowerCase();
  const patterns = [
    { keywords: ['restaurant', 'resto', 'pizzeria', 'sushi', 'burger', 'mcdonald', 'kfc', 'pizza', 'grill', 'brasserie', 'bistro', 'trattoria', 'snack', 'sandwicherie', 'kebab', 'tacos'], category: 'Nourriture', subcategory: 'Plat', confidence: 0.8 },
    { keywords: ['café', 'coffee', 'starbucks', 'bar', 'pub', 'lounge', 'smoothie'], category: 'Boisson', subcategory: 'Autre', confidence: 0.8 },
    { keywords: ['boulangerie', 'pâtisserie', 'bakery', 'pain', 'croissant'], category: 'Nourriture', subcategory: 'Autre', confidence: 0.8 },
    { keywords: ['taxi', 'uber', 'bolt', 'careem', 'parking', 'station', 'essence', 'carburant', 'total', 'shell', 'afriquia', 'petrom', 'vivo'], category: 'Transport', subcategory: 'Taxi', confidence: 0.8 },
    { keywords: ['hotel', 'hôtel', 'riad', 'airbnb', 'auberge', 'motel', 'hostel', 'residence'], category: 'Hébergement', subcategory: 'Hôtel', confidence: 0.85 },
    { keywords: ['marjane', 'carrefour', 'bim', 'label vie', 'acima', 'épicerie', 'supermarché', 'supermarket', 'grocery', 'hanout', 'souk'], category: 'Courses & Épicerie', subcategory: 'Supermarché', confidence: 0.85 },
    { keywords: ['pharmacie', 'pharmacy', 'clinique', 'clinic', 'médecin', 'doctor', 'labo', 'laboratoire', 'dentiste', 'opticien', 'optique'], category: 'Santé & Bien-être', subcategory: 'Pharmacie', confidence: 0.85 },
    { keywords: ['cinéma', 'cinema', 'concert', 'musée', 'museum', 'théâtre', 'sport', 'gym', 'fitness', 'hammam', 'spa', 'bowling', 'karting'], category: 'Loisirs & Activités', subcategory: 'Cinéma', confidence: 0.75 },
    { keywords: ['maroc telecom', 'inwi', 'orange', 'sfr', 'apple', 'samsung', 'microsoft', 'google', 'amazon', 'netflix', 'spotify', 'abonnement'], category: 'Technologie & Services', subcategory: 'Abonnement', confidence: 0.8 },
    { keywords: ['lydec', 'amendis', 'radeef', 'onee', 'iam', 'électricité', 'eau', 'loyer', 'charges'], category: 'Loyer & Factures', subcategory: 'Électricité', confidence: 0.85 },
  ];

  for (const pattern of patterns) {
    if (pattern.keywords.some(kw => name.includes(kw))) {
      return { category: pattern.category, subcategory: pattern.subcategory, categoryConfidence: pattern.confidence, categoryMethod: 'heuristic_merchant' };
    }
  }
  return { category: 'Autre', subcategory: 'Autre', categoryConfidence: 0.2, categoryMethod: 'heuristic_default' };
}

// ─── Tentative 1 : Claude Vision ─────────────────────────────
async function classifyWithClaude(image, detectedMime) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY absent');
  const categoryList = buildCategoryPrompt();
  const prompt = `Analyze this receipt/invoice image carefully.

Reply ONLY in this exact JSON format, no other text:
{"isReceipt": boolean, "reason": "string", "category": "string", "subcategory": "string", "categoryConfidence": number}

Rules for isReceipt:
- true ONLY for commercial receipts, invoices, tickets
- false for: photos of people, landscapes, animals, screenshots, handwritten notes, non-commercial documents

Rules for category — choose EXACTLY ONE from this list:
${categoryList}

Rules for subcategory:
- Must be one of the valid subcategories for the chosen category
- If unsure, use "Autre"
- Must match exactly the subcategory values listed above

Rules for categoryConfidence:
- 0.0 to 1.0 — how confident you are in the category choice
- Use 0.9+ only when the merchant type is unambiguous
- Use 0.5-0.7 when inferring from context
- Use 0.3 when guessing

If isReceipt is false, still provide best-guess category and subcategory based on image content, but set categoryConfidence to 0.`;

  const res = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: detectedMime, data: image } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })
  );
  const data = await res.json();
  const rawText = data.content?.[0]?.text || '{}';
  const match = rawText.match(/\{[\s\S]*?\}/);
  const parsed = match ? JSON.parse(match[0]) : {};
  if (typeof parsed.isReceipt !== 'boolean') throw new Error('Réponse Claude invalide');
  return {
    isReceipt:          parsed.isReceipt,
    reason:             parsed.reason || '',
    method:             'claude',
    category:           parsed.category || 'Autre',
    subcategory:        parsed.subcategory || 'Autre',
    categoryConfidence: typeof parsed.categoryConfidence === 'number' ? parsed.categoryConfidence : 0.5,
  };
}

// ─── Tentative 2 : Google Cloud Vision ───────────────────────
async function classifyWithGoogle(image) {
  if (!process.env.GOOGLE_VISION_API_KEY) throw new Error('GOOGLE_VISION_API_KEY absent');
  const res = await withTimeout(
    fetch(`https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: image },
          features: [
            { type: 'LABEL_DETECTION', maxResults: 10 },
            { type: 'TEXT_DETECTION', maxResults: 1 },
          ],
        }],
      }),
    })
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Erreur Google Vision');
  const response = data.responses?.[0] || {};

  const COMMERCIAL_LABELS = ['receipt', 'invoice', 'document', 'paper', 'font', 'text', 'number'];
  const labels = (response.labelAnnotations || []).map(l => l.description?.toLowerCase() || '');
  const hasCommercialLabel = labels.some(l => COMMERCIAL_LABELS.some(kw => l.includes(kw)));

  const detectedText = response.textAnnotations?.[0]?.description || '';
  const hasNumericText = /\d+[.,]\d{2}/.test(detectedText);

  const isReceipt = hasCommercialLabel && hasNumericText;
  return { isReceipt, reason: null, method: 'google', googleLabels: response.labelAnnotations || [] };
}

// ─── Tentative 3 : Heuristique locale ────────────────────────
function classifyHeuristic(image) {
  // Recherche de patterns typiques d'un reçu dans les octets bruts (métadonnées, EXIF, texte embarqué)
  const rawText = Buffer.from(image, 'base64').toString('latin1');
  const hasAmount  = /\d+[.,]\d{2}/.test(rawText);
  const hasDate    = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(rawText);
  const textBlocks = (rawText.match(/[\x20-\x7E]{4,}/g) || []).length;
  const isReceipt  = textBlocks > 3 && hasAmount && hasDate;
  return { isReceipt, confidence: isReceipt ? 0.6 : 0.4, method: 'heuristic' };
}

// ─── Orchestrateur de classification (niveau 2) ───────────────
async function classifyImage(image, detectedMime) {
  // Tentative 1 — Claude Vision
  try {
    return await classifyWithClaude(image, detectedMime);
  } catch (err) {
    console.error('[OCR Fallback] Claude Vision failed:', err.message);
  }

  // Tentative 2 — Google Cloud Vision
  try {
    return await classifyWithGoogle(image);
  } catch (err) {
    console.error('[OCR Fallback] Google Vision failed:', err.message);
  }

  // Tentative 3 — Heuristique locale (ne peut jamais échouer)
  try {
    return classifyHeuristic(image);
  } catch (err) {
    console.error('[OCR Fallback] Heuristic failed:', err.message);
  }

  // Tentative 4 — Fallback final
  return { isReceipt: true, confidence: 0, method: 'unverified' };
}

// ─── Fetch with timeout ───────────────────────────────────────
async function fetchWithTimeout(url, options, ms = 25000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') throw new Error('Timeout Azure dépassé (25s)');
    throw err;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, contentType } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Image manquante', level_rejected: 1 });
  }

  // ── Niveau 1 : validation format ─────────────────────────────
  const declared = (contentType || '').toLowerCase();
  if (!ALLOWED_MIME.includes(declared)) {
    return res.status(400).json({
      error: 'Seules les images sont acceptées (JPEG, PNG, WEBP, HEIC)',
      level_rejected: 1,
    });
  }

  const detectedMime = detectMimeFromBytes(image);
  if (!detectedMime || !ALLOWED_MIME.includes(detectedMime)) {
    return res.status(400).json({
      error: 'Seules les images sont acceptées (JPEG, PNG, WEBP, HEIC)',
      level_rejected: 1,
    });
  }

  const imageBytes = Buffer.from(image, 'base64');
  if (imageBytes.length > MAX_SIZE_BYTES) {
    return res.status(400).json({
      error: "L'image ne doit pas dépasser 4 Mo",
      level_rejected: 1,
    });
  }

  // Auth : JWT admin ou email invité (header X-Guest-Email)
  const authHeader  = req.headers.authorization || '';
  const guestEmail  = (req.headers['x-guest-email'] || '').trim().toLowerCase();
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let userId;

  if (guestEmail) {
    // Valider que cet email est bien un invité actif dans la table invitations
    const { data: inv, error: invErr } = await supabase
      .from('invitations')
      .select('email')
      .eq('email', guestEmail)
      .eq('status', 'accepted')
      .limit(1)
      .single();
    if (invErr || !inv) {
      return res.status(401).json({ error: 'Invité non reconnu', level_rejected: 1 });
    }
    // Rate limit par email (userId fictif = hash stable de l'email)
    userId = `guest:${guestEmail}`;
  } else {
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Non autorisé', level_rejected: 1 });
    }
    const token = authHeader.slice(7);
    const authedSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await authedSupabase.auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: 'Token invalide', level_rejected: 1 });
    }
    userId = user.id;
  }

  // Rate limit : 20 scans/heure
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await supabase
    .from('ocr_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('timestamp', oneHourAgo);

  if ((count ?? 0) >= RATE_LIMIT) {
    await logOCR(supabase, userId, false, 'Quota horaire dépassé', 1);
    return res.status(429).json({
      error: 'Quota atteint — 20 scans par heure maximum',
      level_rejected: 1,
    });
  }

  // ── Niveau 2 : chaîne de fallback classification ─────────────
  const classification = await classifyImage(image, detectedMime);
  const { isReceipt, reason: classifyReason, method: classificationMethod } = classification;

  // Catégorisation initiale depuis la classification
  let categoryResult = { category: 'Autre', subcategory: 'Autre', categoryConfidence: 0, categoryMethod: 'none' };
  if (classificationMethod === 'claude' && classification.category) {
    categoryResult = {
      category:           classification.category,
      subcategory:        classification.subcategory || 'Autre',
      categoryConfidence: classification.categoryConfidence || 0.7,
      categoryMethod:     'claude',
    };
  } else if (classificationMethod === 'google') {
    categoryResult = categorizeFromGoogleLabels(classification.googleLabels || [], null);
  }

  if (!isReceipt) {
    const userMessage = 'Cette image ne ressemble pas à un reçu. Vérifiez que vous avez bien photographié un ticket de caisse ou une facture.';
    await logOCR(supabase, userId, false, classifyReason || classificationMethod, 2, classificationMethod);
    return res.status(422).json({
      error: userMessage,
      debugReason: classifyReason || null,
      classificationMethod,
      isReceipt: false,
      level_rejected: 2,
    });
  }

  // ── Niveau 3 : Azure Document Intelligence OCR ────────────────
  const endpoint = (process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT || '').replace(/\/$/, '');
  const azureKey = process.env.AZURE_DOC_INTELLIGENCE_KEY;

  let analyzeResult = null;
  try {
    // Soumettre l'analyse
    const submitRes = await fetchWithTimeout(
      `${endpoint}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=2024-11-30`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ base64Source: image }),
      },
      10000
    );

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      throw new Error(`Azure ${submitRes.status}: ${errText.slice(0, 200)}`);
    }

    const operationUrl =
      submitRes.headers.get('Operation-Location') ||
      submitRes.headers.get('operation-location');
    if (!operationUrl) throw new Error('Operation-Location manquant dans la réponse Azure');

    // Polling
    const deadline = Date.now() + 20000;
    let pollData = null;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1200));
      const pollRes = await fetch(operationUrl, {
        headers: { 'Ocp-Apim-Subscription-Key': azureKey },
      });
      pollData = await pollRes.json();
      if (pollData.status === 'succeeded' || pollData.status === 'failed') break;
    }

    if (!pollData || pollData.status !== 'succeeded') {
      throw new Error(`Analyse Azure : ${pollData?.status || 'timeout'}`);
    }

    analyzeResult = pollData.analyzeResult;
  } catch (err) {
    await logOCR(supabase, userId, false, err.message, 3, classificationMethod);
    return res.status(503).json({
      error: `Erreur OCR : ${err.message}`,
      level_rejected: 3,
    });
  }

  // ── Niveau 4 : structuration résultat ─────────────────────────
  const doc = analyzeResult?.documents?.[0];
  const fields = doc?.fields || {};
  const confidence = doc?.confidence ?? 0;
  const needsManualReview = confidence < 0.7;

  const getFieldValue = (field) => {
    if (!field) return null;
    // v4 currency amount
    if (field.valueCurrency?.amount != null) return field.valueCurrency.amount;
    if (field.value != null) return field.value;
    if (field.valueNumber != null) return field.valueNumber;
    if (field.content) return field.content;
    return null;
  };

  const items = (fields.Items?.valueArray || []).map(item => {
    const obj = item.valueObject || {};
    return {
      description: obj.Description?.content || obj.Name?.content || '',
      amount: getFieldValue(obj.TotalPrice) ?? getFieldValue(obj.Price) ?? 0,
    };
  }).filter(i => i.description);

  const merchant = fields.MerchantName?.content || fields.MerchantName?.valueString || '';

  // Enrichissement catégorisation depuis le nom du marchand si confiance faible
  if (categoryResult.categoryConfidence < 0.5 && merchant) {
    const merchantCategory = categorizeFromMerchantName(merchant);
    if (merchantCategory.categoryConfidence > categoryResult.categoryConfidence) {
      categoryResult = merchantCategory;
    }
  }

  const result = {
    merchant,
    date:                 fields.TransactionDate?.valueDate || fields.TransactionDate?.content || '',
    total:                getFieldValue(fields.Total),
    subtotal:             getFieldValue(fields.Subtotal),
    tax:                  getFieldValue(fields.TotalTax),
    tip:                  getFieldValue(fields.Tip),
    currency:             fields.Total?.valueCurrency?.currencyCode || fields.CurrencyCode?.content || null,
    items,
    confidence:           Math.round(confidence * 100) / 100,
    needsManualReview,
    verificationStatus:   classificationMethod === 'unverified' ? 'unverified' : 'verified',
    classificationMethod,
    category:             categoryResult.category,
    subcategory:          categoryResult.subcategory,
    categoryConfidence:   categoryResult.categoryConfidence,
    categoryMethod:       categoryResult.categoryMethod,
  };

  await logOCR(supabase, userId, true, null, null, classificationMethod);

  return res.status(200).json(result);
}
