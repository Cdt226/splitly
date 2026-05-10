// api/scan-receipt.js
// Vercel Serverless Function — Pipeline OCR 4 niveaux

import { createClient } from '@supabase/supabase-js';

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
async function logOCR(client, userId, success, errorReason, levelRejected) {
  try {
    await client.from('ocr_logs').insert({
      user_id: userId,
      success,
      error_reason: errorReason ?? null,
      level_rejected: levelRejected ?? null,
    });
  } catch {}
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

  // Vérification JWT
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé', level_rejected: 1 });
  }
  const token = authHeader.slice(7);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return res.status(401).json({ error: 'Token invalide', level_rejected: 1 });
  }

  // Rate limit : 20 scans/heure
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await supabase
    .from('ocr_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('timestamp', oneHourAgo);

  if ((count ?? 0) >= RATE_LIMIT) {
    await logOCR(supabase, user.id, false, 'Quota horaire dépassé', 1);
    return res.status(429).json({
      error: 'Quota atteint — 20 scans par heure maximum',
      level_rejected: 1,
    });
  }

  // ── Niveau 2 : pré-classification Claude Vision ───────────────
  let isReceipt = true;
  let claudeReason = '';
  try {
    const claudeRes = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: detectedMime, data: image },
              },
              {
                type: 'text',
                text: 'Look at this image. Is it a photo of a receipt or invoice? Reply ONLY in JSON: {"isReceipt": boolean, "reason": string}. Be strict: photos of people, landscapes, animals, screenshots unrelated to commerce must return isReceipt: false.',
              },
            ],
          }],
        }),
      },
      15000
    );
    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || '{}';
    const match = rawText.match(/\{[\s\S]*?\}/);
    const parsed = match ? JSON.parse(match[0]) : {};
    isReceipt = parsed.isReceipt !== false; // default true on parse error
    claudeReason = parsed.reason || '';
  } catch {
    // Si Claude échoue, on continue vers Azure
    isReceipt = true;
  }

  if (!isReceipt) {
    const reason = claudeReason
      ? `Ce document ne semble pas être un reçu : ${claudeReason}`
      : 'Ce document ne semble pas être un reçu ou une facture.';
    await logOCR(supabase, user.id, false, reason, 2);
    return res.status(422).json({ error: reason, isReceipt: false, level_rejected: 2 });
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
    await logOCR(supabase, user.id, false, err.message, 3);
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

  const result = {
    merchant:          fields.MerchantName?.content || fields.MerchantName?.valueString || '',
    date:              fields.TransactionDate?.valueDate || fields.TransactionDate?.content || '',
    total:             getFieldValue(fields.Total),
    tax:               getFieldValue(fields.TotalTax),
    currency:          fields.CurrencyCode?.content || 'EUR',
    items,
    confidence:        Math.round(confidence * 100) / 100,
    needsManualReview,
  };

  await logOCR(supabase, user.id, true, null, null);

  return res.status(200).json(result);
}
