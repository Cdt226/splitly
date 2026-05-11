// src/hooks/useOCRModule.jsx
// Hook OCR générique — aucune logique SplitLy ici

import { useState, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import { supabase } from '../supabase.js';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

// ─── Nettoyage valeur numérique ───────────────────────────────
// Supprime symboles devises, espaces, convertit virgules en points
function cleanNumeric(val) {
  if (val == null) return null;
  const n = typeof val === 'number' ? val : parseFloat(
    String(val).replace(/[^\d.,-]/g, '').replace(',', '.')
  );
  return isNaN(n) ? null : n;
}

// ─── Adapter "receipt" → champs formulaire SplitLy ───────────
export const receiptAdapter = (raw) => {
  const total = cleanNumeric(raw.total);
  const needsManualReview = raw.needsManualReview || total == null;
  return {
    detail:   raw.merchant || '',
    unit:     total != null ? String(total) : '',
    qty:      1,
    comment:  raw.date ? `Reçu du ${raw.date}` : '',
    // Catégorisation automatique OCR
    category:           raw.category    || 'Autre',
    sub:                raw.subcategory || 'Autre',
    categoryConfidence: raw.categoryConfidence || 0,
    categoryMethod:     raw.categoryMethod     || 'none',
    paidBy:   '',
    included: [],
    eventId:  '',
    // Métadonnées (préfixe _ = non envoyées au formulaire principal)
    _needsManualReview:  needsManualReview,
    _currency:           raw.currency        || null,
    _tax:                cleanNumeric(raw.tax),
    _subtotal:           cleanNumeric(raw.subtotal),
    _receiptNumber:      raw.receiptNumber   || null,
    _paymentMethod:      raw.paymentMethod   || null,
    _items:              raw.items           || [],
    _confidence:         raw.confidence      ?? 0,
    _extractionSources:  raw.extractionSources || {},
  };
};

const BUILT_IN_ADAPTERS = { receipt: receiptAdapter };

// ─── Hook ─────────────────────────────────────────────────────
export function useOCRModule({ adapter = 'receipt', onSuccess, onInvalid, onError, guestEmail } = {}) {
  const [status,      setStatus]      = useState('idle');   // idle|compressing|uploading|processing|validating|success|error
  const [result,      setResult]      = useState(null);
  const [error,       setError]       = useState(null);
  const [invalidMeta, setInvalidMeta] = useState(null);  // { classificationMethod, debugReason } — renseigné sur 422

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
    setInvalidMeta(null);
  }, []);

  const scan = useCallback(async (file) => {
    if (!file) return;

    // Validation format côté client
    if (!ALLOWED_MIME.includes(file.type)) {
      const msg = 'Seules les images sont acceptées (JPEG, PNG, WEBP, HEIC)';
      setError(msg);
      setStatus('error');
      onInvalid?.(msg);
      return;
    }

    try {
      // Compression
      setStatus('compressing');
      const compressed = await imageCompression(file, {
        maxSizeMB:        4,
        maxWidthOrHeight: 2048,
        useWebWorker:     true,
        initialQuality:   0.8,
      });

      // Base64
      setStatus('uploading');
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });

      // Auth : JWT admin ou email invité
      let authHeaders;
      if (guestEmail) {
        authHeaders = { 'X-Guest-Email': guestEmail };
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Non authentifié — veuillez vous reconnecter');
        authHeaders = { 'Authorization': `Bearer ${token}` };
      }

      // Appel API
      setStatus('processing');
      const res = await fetch('/api/scan-receipt', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ image: base64, contentType: file.type }),
      });

      setStatus('validating');
      const data = await res.json();

      if (!res.ok) {
        // Niveau 2 : pas un reçu
        if (res.status === 422 && data.isReceipt === false) {
          setError(data.error);
          setInvalidMeta({ classificationMethod: data.classificationMethod || null, debugReason: data.debugReason || null });
          setStatus('error');
          onInvalid?.(data.error);
          return;
        }
        throw new Error(data.error || `Erreur serveur (${res.status})`);
      }

      // Transformer via l'adapter
      const adapterFn = typeof adapter === 'function'
        ? adapter
        : BUILT_IN_ADAPTERS[adapter];

      const transformed = adapterFn ? adapterFn(data) : data;

      setResult({ raw: data, transformed });
      setStatus('success');
      onSuccess?.(transformed, data);

    } catch (err) {
      const msg = err.message || 'Erreur inconnue';
      setError(msg);
      setStatus('error');
      onError?.(err);
    }
  }, [adapter, onSuccess, onInvalid, onError, guestEmail]);

  return { scan, status, result, error, invalidMeta, reset };
}
