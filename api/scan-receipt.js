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
  api: { bodyParser: { sizeLimit: '15mb' } },
};

// ─── Magic bytes detection ────────────────────────────────────
function detectMimeFromBytes(base64) {
  const buf = Buffer.from(base64.slice(0, 24), 'base64');
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
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

// ─── Promise.race timeout ─────────────────────────────────────
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

// ─── Normalisation date → YYYY-MM-DD ─────────────────────────
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const ymd = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

// ─── Détection devise depuis texte brut ──────────────────────
function detectCurrencyFromText(text) {
  if (!text) return null;
  if (/\bDH\b|\bMAD\b|\bDhs\b/i.test(text)) return 'MAD';
  if (/\bEUR\b|€/.test(text)) return 'EUR';
  if (/\bUSD\b|\$/.test(text)) return 'USD';
  if (/\bGBP\b|£/.test(text)) return 'GBP';
  return null;
}

// ─── Détection devise depuis résultat Azure ──────────────────
function detectCurrencyFromContent(azureResult) {
  return detectCurrencyFromText(azureResult?.content || '');
}

// ─── Catégorisation depuis les labels Google Vision ──────────
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

// ─── Extraction structurée depuis Azure Document Intelligence ─
function extractFromAzure(analyzeResult) {
  const doc    = analyzeResult?.documents?.[0];
  const fields = doc?.fields || {};

  const fv = (field) => {
    if (!field) return null;
    if (field.valueCurrency?.amount != null) return field.valueCurrency.amount;
    if (typeof field.value === 'number') return field.value;
    if (field.valueNumber != null) return field.valueNumber;
    const parsed = parseFloat(String(field.content || '').replace(',', '.'));
    return isNaN(parsed) ? null : parsed;
  };

  const merchant = fields.MerchantName?.content || fields.VendorName?.content || null;

  const items = (fields.Items?.valueArray || []).map(item => {
    const o = item.valueObject || {};
    return {
      name:      o.Description?.content || o.Name?.content || null,
      amount:    o.TotalPrice?.valueCurrency?.amount ?? fv(o.TotalPrice),
      quantity:  o.Quantity?.valueNumber ?? null,
      unitPrice: o.UnitPrice?.valueCurrency?.amount ?? fv(o.UnitPrice),
    };
  }).filter(i => i.name || i.amount != null);

  const currency = fields.Total?.valueCurrency?.currencyCode
    || fields.CurrencyCode?.content
    || detectCurrencyFromContent(analyzeResult)
    || 'MAD';

  const categoryResult = merchant
    ? categorizeFromMerchantName(merchant)
    : { category: 'Autre', subcategory: 'Autre', categoryConfidence: 0.1, categoryMethod: 'heuristic_none' };

  return {
    merchant,
    date:            fields.TransactionDate?.valueDate || fields.InvoiceDate?.valueDate || null,
    total:           fields.Total?.valueCurrency?.amount ?? fields.InvoiceTotal?.valueCurrency?.amount ?? fv(fields.Total),
    tax:             fields.TotalTax?.valueCurrency?.amount ?? fv(fields.TotalTax),
    subtotal:        fields.Subtotal?.valueCurrency?.amount ?? fv(fields.Subtotal),
    currency,
    receiptNumber:   fields.TransactionId?.content || fields.InvoiceId?.content || null,
    paymentMethod:   fields.PaymentType?.content || null,
    merchantPhone:   fields.MerchantPhoneNumber?.content || null,
    merchantAddress: fields.MerchantAddress?.content || null,
    items,
    confidence:      doc?.confidence ?? 0.5,
    ...categoryResult,
  };
}

// ─── Extraction depuis Google Cloud Vision ───────────────────
function extractFromGoogleVision(googleResponse) {
  const resp         = googleResponse?.responses?.[0] || {};
  const labels       = resp.labelAnnotations || [];
  const text         = resp.textAnnotations?.[0]?.description || '';
  const webEntities  = resp.webDetection?.webEntities || [];

  // Date depuis texte brut
  let extractedDate = null;
  for (const re of [
    /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/,
    /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/,
  ]) {
    const m = text.match(re);
    if (m) { extractedDate = normalizeDate(m[0]); break; }
  }

  // Montant depuis texte brut
  let extractedAmount = null;
  for (const re of [
    /(?:total|montant|amount|ttc)[:\s]*(\d+[.,]\d{2})/i,
    /(\d+[.,]\d{2})\s*(?:dh|mad|eur|€|\$)/i,
  ]) {
    const m = text.match(re);
    if (m) { extractedAmount = parseFloat(m[1].replace(',', '.')); break; }
  }

  // Marchand depuis webEntities
  const merchantEntity   = webEntities.find(e => e.score > 0.5 && e.description);
  const extractedMerchant = merchantEntity?.description || null;

  const categoryResult = categorizeFromGoogleLabels(labels, extractedMerchant);

  return {
    merchant:      extractedMerchant,
    date:          extractedDate,
    total:         extractedAmount,
    tax:           null,
    subtotal:      null,
    currency:      detectCurrencyFromText(text) || 'MAD',
    receiptNumber: null,
    paymentMethod: null,
    items:         [],
    confidence:    0.4,
    ...categoryResult,
  };
}

// ─── Extraction heuristique depuis texte OCR brut ────────────
function extractFromHeuristic(rawText, merchant) {
  const text = rawText || '';

  const dateMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  const date      = dateMatch ? normalizeDate(dateMatch[0]) : null;

  const amounts = [...text.matchAll(/(\d+[.,]\d{2})/g)]
    .map(m => parseFloat(m[1].replace(',', '.')));
  const total = amounts.length > 0 ? Math.max(...amounts) : null;

  const categoryResult = categorizeFromMerchantName(merchant);

  return {
    merchant,
    date,
    total,
    tax:           null,
    subtotal:      null,
    currency:      detectCurrencyFromText(text) || 'MAD',
    receiptNumber: null,
    paymentMethod: null,
    items:         [],
    confidence:    0.3,
    ...categoryResult,
  };
}

// ─── Fusion des résultats de toutes les sources ───────────────
function mergeExtractionResults(claudeData, azureData, googleData, heuristicData) {
  const pick = (...vals) => vals.find(v => v !== null && v !== undefined && v !== '');

  const claudeGoodCat = (claudeData?.categoryConfidence ?? 0) > 0.7;

  const extractionSources = {
    merchant: claudeData?.merchant ? 'claude' : azureData?.merchant ? 'azure' : googleData?.merchant ? 'google' : 'heuristic',
    date:     claudeData?.date     ? 'claude' : azureData?.date     ? 'azure' : googleData?.date     ? 'google' : 'heuristic',
    total:    claudeData?.total    != null ? 'claude' : azureData?.total != null ? 'azure' : googleData?.total != null ? 'google' : 'heuristic',
    category: claudeGoodCat ? 'claude' : (azureData?.category && azureData.category !== 'Autre') ? 'azure' : (googleData?.category && googleData.category !== 'Autre') ? 'google' : 'heuristic',
  };

  return {
    merchant:        pick(claudeData?.merchant, azureData?.merchant, googleData?.merchant, heuristicData?.merchant),
    date:            pick(claudeData?.date, azureData?.date, googleData?.date, heuristicData?.date),
    total:           pick(claudeData?.total, azureData?.total, googleData?.total, heuristicData?.total),
    tax:             pick(claudeData?.tax, azureData?.tax),
    subtotal:        pick(azureData?.subtotal),
    currency:        pick(claudeData?.currency, azureData?.currency, googleData?.currency, heuristicData?.currency, 'MAD'),
    category:        pick(
      claudeGoodCat ? claudeData?.category : null,
      azureData?.category   !== 'Autre' ? azureData?.category   : null,
      googleData?.category  !== 'Autre' ? googleData?.category  : null,
      heuristicData?.category,
      'Autre'
    ),
    subcategory:     pick(
      claudeGoodCat ? claudeData?.subcategory : null,
      azureData?.subcategory  !== 'Autre' ? azureData?.subcategory  : null,
      googleData?.subcategory !== 'Autre' ? googleData?.subcategory : null,
      heuristicData?.subcategory,
      'Autre'
    ),
    categoryConfidence: pick(
      claudeGoodCat   ? claudeData?.categoryConfidence   : null,
      azureData?.categoryConfidence,
      googleData?.categoryConfidence,
      heuristicData?.categoryConfidence,
      0.1
    ),
    categoryMethod:  pick(
      claudeGoodCat ? claudeData?.categoryMethod : null,
      azureData?.categoryMethod,
      googleData?.categoryMethod,
      heuristicData?.categoryMethod,
      'none'
    ),
    items:           pick(
      claudeData?.items?.length   > 0 ? claudeData.items   : null,
      azureData?.items?.length    > 0 ? azureData.items    : null,
      []
    ),
    receiptNumber:   pick(claudeData?.receiptNumber, azureData?.receiptNumber),
    paymentMethod:   pick(claudeData?.paymentMethod, azureData?.paymentMethod),
    merchantPhone:   pick(azureData?.merchantPhone),
    merchantAddress: pick(azureData?.merchantAddress),
    confidence:      Math.max(
      claudeData?.confidence    || 0,
      azureData?.confidence     || 0,
      googleData?.confidence    || 0,
      heuristicData?.confidence || 0
    ),
    extractionSources,
  };
}

// ─── T1 & T2 : Claude Vision (Haiku ou Sonnet) ───────────────
async function classifyWithClaude(image, detectedMime, model, timeoutMs) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY absent');
  const categoryList = buildCategoryPrompt();

  const prompt = `You are a receipt and invoice analysis expert.

Analyze this image carefully and extract ALL available information.

Reply ONLY in this exact JSON format, no other text:
{
  "isReceipt": boolean,
  "reason": "string",
  "merchant": "string or null",
  "date": "YYYY-MM-DD or null",
  "total": number or null,
  "tax": number or null,
  "currency": "string or null",
  "category": "string",
  "subcategory": "string",
  "categoryConfidence": number,
  "items": [{"name": "string", "amount": number, "quantity": number or null}],
  "paymentMethod": "string or null",
  "receiptNumber": "string or null",
  "confidence": number
}

Rules:
- isReceipt: true ONLY for commercial receipts, invoices, tickets
- merchant: exact business name as shown on the document
- date: convert any date format to YYYY-MM-DD
- total: numeric value only, no currency symbol
- tax: numeric value only, no currency symbol
- currency: ISO code (MAD, EUR, USD, GBP...) — default to MAD if Moroccan merchant detected
- category: choose EXACTLY ONE from:
${categoryList}
- subcategory: must match the chosen category's subcategories
- categoryConfidence: 0.0 to 1.0 — how confident you are in the category
- items: list of individual line items if visible on the receipt
- paymentMethod: "cash", "card", "mobile" or null
- receiptNumber: ticket/invoice number if visible
- confidence: overall extraction confidence 0.0-1.0
- If isReceipt is false, set merchant/date/total/tax/currency/items to null`;

  const res = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        messages: [{
          role:    'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: detectedMime, data: image } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    }),
    timeoutMs
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${res.status}: ${data.error?.message || JSON.stringify(data).slice(0, 120)}`);
  }

  const rawText  = data.content?.[0]?.text || '{}';
  const jsonStart = rawText.indexOf('{');
  const jsonEnd   = rawText.lastIndexOf('}');
  const jsonStr   = jsonStart !== -1 && jsonEnd > jsonStart ? rawText.slice(jsonStart, jsonEnd + 1) : '{}';
  const parsed    = JSON.parse(jsonStr);

  if (typeof parsed.isReceipt !== 'boolean') throw new Error('Réponse Claude invalide');

  const method = model.includes('haiku') ? 'claude_haiku' : 'claude_sonnet';
  return {
    isReceipt:          parsed.isReceipt,
    reason:             parsed.reason || '',
    method,
    merchant:           parsed.merchant   || null,
    date:               parsed.date       || null,
    total:              typeof parsed.total === 'number' ? parsed.total : null,
    tax:                typeof parsed.tax  === 'number' ? parsed.tax   : null,
    subtotal:           null,
    currency:           parsed.currency   || null,
    category:           parsed.category   || 'Autre',
    subcategory:        parsed.subcategory || 'Autre',
    categoryConfidence: typeof parsed.categoryConfidence === 'number' ? parsed.categoryConfidence : 0.5,
    categoryMethod:     method,
    items:              Array.isArray(parsed.items) ? parsed.items.filter(i => i.name || i.amount != null) : [],
    paymentMethod:      parsed.paymentMethod  || null,
    receiptNumber:      parsed.receiptNumber  || null,
    confidence:         typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
  };
}

// ─── T3 : Azure Document Intelligence (classification + extraction) ─
async function classifyWithAzure(image) {
  const endpoint = (process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT || '').replace(/\/$/, '');
  const azureKey = process.env.AZURE_DOC_INTELLIGENCE_KEY;
  if (!endpoint || !azureKey) throw new Error('Azure config absente');

  const submitRes = await fetchWithTimeout(
    `${endpoint}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=2024-11-30`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type':              'application/json',
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

  const analyzeResult = pollData.analyzeResult;
  const extracted     = extractFromAzure(analyzeResult);
  const hasKeyFields  = !!(extracted.total != null || extracted.merchant || extracted.date);
  const isReceipt     = extracted.confidence >= 0.3 || hasKeyFields;

  return {
    isReceipt,
    method: 'azure',
    reason: isReceipt ? null : `Confiance Azure insuffisante (${Math.round(extracted.confidence * 100)}%)`,
    analyzeResult,
    ...extracted,
  };
}

// ─── T4 : Google Cloud Vision (labels + texte + web entities) ─
async function classifyWithGoogle(image) {
  if (!process.env.GOOGLE_VISION_API_KEY) throw new Error('GOOGLE_VISION_API_KEY absent');
  const res = await withTimeout(
    fetch(`https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image:    { content: image },
          features: [
            { type: 'LABEL_DETECTION',  maxResults: 15 },
            { type: 'TEXT_DETECTION',   maxResults: 1  },
            { type: 'WEB_DETECTION',    maxResults: 5  },
          ],
        }],
      }),
    }),
    5000
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Erreur Google Vision');
  const response = data.responses?.[0] || {};

  const RECEIPT_LABELS = [
    'receipt', 'invoice', 'bill', 'payment', 'cash register', 'pos', 'retail',
    'supermarket', 'shopping', 'checkout', 'price', 'total', 'amount', 'tax',
    'vat', 'tva', 'ttc', 'ht', 'document', 'paper', 'font', 'text', 'number',
    'ticket', 'purchase', 'sale', 'store', 'shop',
  ];
  const labels          = (response.labelAnnotations || []).map(l => l.description?.toLowerCase() || '');
  const hasReceiptLabel = labels.some(l => RECEIPT_LABELS.some(kw => l.includes(kw)));
  const detectedText    = response.textAnnotations?.[0]?.description || '';
  const hasNumericText  = /\d+[.,]\d{2}/.test(detectedText);
  const hasSubstantialText = detectedText.length > 30;

  const isReceipt = (hasReceiptLabel && hasNumericText) || (hasSubstantialText && hasNumericText);
  const extracted = extractFromGoogleVision(data);

  return {
    isReceipt,
    reason:       null,
    method:       'google',
    googleLabels: response.labelAnnotations || [],
    ...extracted,
  };
}

// ─── T5 : Heuristique locale (classification seulement) ──────
function classifyHeuristic(image) {
  const rawText    = Buffer.from(image, 'base64').toString('latin1');
  const hasAmount  = /\d+[.,]\d{2}/.test(rawText);
  const hasDate    = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(rawText);
  const textBlocks = (rawText.match(/[\x20-\x7E]{4,}/g) || []).length;
  const isReceipt  = textBlocks > 3 && hasAmount && hasDate;
  return { isReceipt, confidence: isReceipt ? 0.6 : 0.4, method: 'heuristic' };
}

// ─── Orchestrateur T1 → T2 → T3 → T4 → T5 → laisser passer ──
async function classifyImage(image, detectedMime) {
  console.log('[OCR] T1 — Claude Haiku | API Key présente:', !!process.env.ANTHROPIC_API_KEY);
  try {
    const r = await classifyWithClaude(image, detectedMime, 'claude-haiku-4-5-20251001', 8000);
    console.log('[OCR] T1 OK — isReceipt:', r.isReceipt, '| method:', r.method);
    return r;
  } catch (err) {
    console.error('[OCR] T1 Haiku échoué:', err.message);
  }

  console.log('[OCR] T2 — Claude Sonnet...');
  try {
    const r = await classifyWithClaude(image, detectedMime, 'claude-sonnet-4-6', 15000);
    console.log('[OCR] T2 OK — isReceipt:', r.isReceipt, '| method:', r.method);
    return r;
  } catch (err) {
    console.error('[OCR] T2 Sonnet échoué:', err.message);
  }

  console.log('[OCR] T3 — Azure Document Intelligence | Endpoint présent:', !!(process.env.AZURE_DOC_INTELLIGENCE_ENDPOINT));
  try {
    const r = await classifyWithAzure(image);
    console.log('[OCR] T3 résultat — isReceipt:', r.isReceipt, '| reason:', r.reason);
    return r;
  } catch (err) {
    console.error('[OCR] T3 Azure échoué:', err.message);
  }

  console.log('[OCR] T4 — Google Vision...');
  try {
    const r = await classifyWithGoogle(image);
    console.log('[OCR] T4 résultat — isReceipt:', r.isReceipt,
      '| labels:', (r.googleLabels || []).slice(0, 4).map(l => l.description).join(', '));
    return r;
  } catch (err) {
    console.error('[OCR] T4 Google Vision échoué:', err.message);
  }

  console.log('[OCR] T5 — Heuristique locale...');
  const r = classifyHeuristic(image);
  console.log('[OCR] T5 résultat — isReceipt:', r.isReceipt);
  return r;
}

// ─── Fetch avec timeout (AbortController) ────────────────────
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

// ─── Quick scan (action=quick) — pré-remplissage inline ─────
const QUICK_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const QUICK_MAX_BYTES    = 10 * 1024 * 1024;

async function quickScanDocument(image, mime) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY absent');
  const categoryList = buildCategoryPrompt();

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
    : { type: 'image',    source: { type: 'base64', media_type: mime, data: image } };

  const res = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
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
        messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: userText }] }],
      }),
    }),
    20000
  );

  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${data.error?.message || 'Erreur API'}`);

  const rawText   = data.content?.[0]?.text || '{}';
  const jsonStart = rawText.indexOf('{');
  const jsonEnd   = rawText.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd <= jsonStart) throw new Error('Réponse non structurée');

  try { return JSON.parse(rawText.slice(jsonStart, jsonEnd + 1)); }
  catch { throw new Error('Réponse JSON invalide'); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { image, contentType, action } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Image manquante', level_rejected: 1 });
  }

  const declared   = (contentType || '').toLowerCase();
  const imageBytes = Buffer.from(image, 'base64');

  // ── Validation spécifique action=quick (images + PDF, 10 Mo) ─
  if (action === 'quick') {
    if (!QUICK_ALLOWED_MIME.includes(declared)) {
      return res.status(400).json({ error: 'Format non supporté — utilisez JPEG, PNG, WEBP ou PDF', level_rejected: 1 });
    }
    if (imageBytes.length > QUICK_MAX_BYTES) {
      return res.status(400).json({ error: 'Fichier trop volumineux (max 10 Mo)', level_rejected: 1 });
    }
  } else {
    // ── Niveau 1 : validation format pipeline complet (images, 4 Mo) ─
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
    if (imageBytes.length > MAX_SIZE_BYTES) {
      return res.status(400).json({
        error: "L'image ne doit pas dépasser 4 Mo",
        level_rejected: 1,
      });
    }
  }

  // ── Auth ──────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  const guestEmail = (req.headers['x-guest-email'] || '').trim().toLowerCase();
  const supabase   = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let userId;

  if (guestEmail) {
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

  // ── Rate limit : 20 scans/heure ───────────────────────────────
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

  // ── Action quick scan : analyse directe via Claude ───────────
  if (action === 'quick') {
    try {
      const parsed = await quickScanDocument(image, declared);
      await logOCR(supabase, userId, true, null, null, 'claude_sonnet');
      return res.status(200).json(parsed);
    } catch (err) {
      await logOCR(supabase, userId, false, err.message, null, 'claude_sonnet');
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'Délai dépassé — réessayez avec un fichier plus léger' });
      }
      return res.status(500).json({ error: err.message || "Erreur lors de l'analyse" });
    }
  }

  // ── Niveau 2 : chaîne de classification (pipeline complet) ───
  const detectedMime  = detectMimeFromBytes(image);
  const classification = await classifyImage(image, detectedMime);
  const { isReceipt, reason: classifyReason, method: classificationMethod } = classification;

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

  // ── Niveau 3 : Azure Document Intelligence (extraction) ───────
  let azureData = null;

  if (classificationMethod === 'azure' && classification.analyzeResult) {
    // Réutiliser les résultats Azure déjà obtenus lors de la classification T3
    console.log('[OCR] Niveau 3 — réutilisation des résultats Azure (T3)');
    azureData = extractFromAzure(classification.analyzeResult);
  } else {
    try {
      console.log('[OCR] Niveau 3 — appel Azure Document Intelligence OCR...');
      const azureResult = await classifyWithAzure(image);
      azureData = extractFromAzure(azureResult.analyzeResult);
    } catch (err) {
      await logOCR(supabase, userId, false, err.message, 3, classificationMethod);
      return res.status(503).json({
        error: `Erreur OCR : ${err.message}`,
        level_rejected: 3,
      });
    }
  }

  // ── Niveau 4 : fusion multi-sources ──────────────────────────
  // Données du classifieur (si Claude ou Google)
  const isClaudeMethod = classificationMethod === 'claude_haiku' || classificationMethod === 'claude_sonnet';
  const claudeData     = isClaudeMethod ? classification : null;
  const googleData     = classificationMethod === 'google' ? classification : null;

  // Extraction heuristique depuis le texte brut Azure (toujours disponible)
  const heuristicData  = extractFromHeuristic(
    classification.analyzeResult?.content || azureData?.merchant || '',
    azureData?.merchant || null
  );

  const merged = mergeExtractionResults(claudeData, azureData, googleData, heuristicData);

  await logOCR(supabase, userId, true, null, null, classificationMethod);

  return res.status(200).json({
    // Champs formulaire
    merchant:           merged.merchant,
    date:               merged.date,
    total:              merged.total,
    tax:                merged.tax,
    subtotal:           merged.subtotal,
    currency:           merged.currency,
    category:           merged.category,
    subcategory:        merged.subcategory,
    categoryConfidence: merged.categoryConfidence,
    categoryMethod:     merged.categoryMethod,
    items:              merged.items,
    receiptNumber:      merged.receiptNumber,
    paymentMethod:      merged.paymentMethod,
    merchantPhone:      merged.merchantPhone,
    merchantAddress:    merged.merchantAddress,
    // Métadonnées
    confidence:          merged.confidence,
    needsManualReview:   merged.confidence < 0.5,
    verificationStatus:  classificationMethod === 'unverified' ? 'unverified' : 'verified',
    classificationMethod,
    extractionSources:   merged.extractionSources,
  });
}
