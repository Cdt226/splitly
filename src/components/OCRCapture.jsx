// src/components/OCRCapture.jsx
// Composant de capture et traitement OCR — aucune logique SplitLy

import { useRef, useState } from 'react';
import { useOCRModule } from '../hooks/useOCRModule.jsx';
import { CATEGORIES } from '../constants.js';
import { S } from '../styles.js';

const STATUS_LABELS = {
  compressing: 'Compression...',
  uploading:   'Envoi...',
  processing:  'Analyse du document...',
  validating:  'Vérification...',
};

const STATUS_PROGRESS = {
  idle:        0,
  compressing: 20,
  uploading:   45,
  processing:  70,
  validating:  90,
  success:     100,
  error:       100,
};

// ─── Barre de progression ─────────────────────────────────────
function ProgressBar({ status }) {
  const pct   = STATUS_PROGRESS[status] || 0;
  const label = STATUS_LABELS[status] || '';
  const isErr = status === 'error';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: isErr ? '#C62828' : 'var(--text-sub)' }}>
          {label || (status === 'success' ? '✓ Terminé' : '')}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: isErr ? '#C62828' : 'var(--text)' }}>
          {pct}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progression du scan"
        style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}
      >
        <div style={{
          height: '100%',
          width:  `${pct}%`,
          borderRadius: 3,
          background:   isErr ? '#C62828' : status === 'success' ? '#2E7D32' : '#1565C0',
          transition:   'width 0.4s ease',
        }} />
      </div>
    </div>
  );
}

// ─── Champ éditable pour review ──────────────────────────────
function ReviewField({ id, label, value, onChange, type = 'text', required = false }) {
  const isEmpty = required && !String(value || '').trim();
  return (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={id} style={{ ...S.label, display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {required && <span style={{ color: '#C62828' }}>*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={isEmpty ? 'À compléter' : undefined}
        aria-describedby={`${id}-hint`}
        style={{
          ...S.input,
          borderColor: isEmpty ? '#FFB74D' : undefined,
        }}
      />
      {isEmpty && (
        <div id={`${id}-hint`} style={{ fontSize: 11, color: '#E65100', marginTop: 3 }}>
          ⚠️ Champ obligatoire
        </div>
      )}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────
export function OCRCapture({ onFill, onClose, onManualEntry, isMobile, guestEmail }) {
  const cameraRef  = useRef(null);
  const galleryRef = useRef(null);

  // Champs éditables (pour review ou succès)
  const [editFields, setEditFields] = useState(null);

  const handleSuccess = (transformed, raw) => {
    setEditFields({
      merchant: raw.merchant || '',
      total:    raw.total != null ? String(raw.total) : '',
      date:     raw.date  || '',
      comment:  transformed.comment,
      // Catégorisation automatique OCR
      category:           transformed.category    || 'Autre',
      subcategory:        transformed.sub         || 'Autre',
      categoryConfidence: raw.categoryConfidence  || 0,
      categoryMethod:     raw.categoryMethod      || 'none',
      // Champs internes pour l'adapter
      detail:   transformed.detail,
      unit:     transformed.unit,
      // Métadonnées informatives
      currency: raw.currency  || null,
      tax:      raw.tax       != null ? String(raw.tax)      : '',
      subtotal: raw.subtotal  != null ? String(raw.subtotal) : '',
    });
  };

  const { scan, status, result, error, reset } = useOCRModule({
    adapter:    'receipt',
    onSuccess:  handleSuccess,
    guestEmail,
  });

  const isActive  = !['idle', 'success', 'error'].includes(status);
  const isSuccess = status === 'success';
  const isError   = status === 'error';
  const isInvalid = isError && result === null && error && !error.includes('images sont acceptées');

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setEditFields(null);
      scan(file);
    }
    e.target.value = '';
  };

  // Champs obligatoires : merchant, total, date
  const requiredOk = editFields &&
    String(editFields.merchant || '').trim() &&
    String(editFields.total    || '').trim() &&
    String(editFields.date     || '').trim();

  const handleConfirm = () => {
    if (!editFields || !requiredOk) return;
    onFill({
      detail:  editFields.merchant || editFields.detail,
      unit:    editFields.total || editFields.unit,
      qty:     1,
      comment: editFields.comment,
      category: editFields.category,
      sub:      editFields.subcategory,
    });
  };

  const handleReset = () => {
    reset();
    setEditFields(null);
  };

  // "Saisir manuellement" utilise onManualEntry si dispo, sinon onClose
  const handleManualEntry = onManualEntry || onClose;

  return (
    <div
      style={{
        ...S.card,
        border:     '1.5px solid #1565C0',
        marginBottom: 12,
        background: 'var(--card-bg)',
      }}
      role="region"
      aria-label="Scanner un reçu"
    >
      {/* En-tête */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>📷</span>
          Scanner un reçu
        </div>
        <button
          onClick={onClose}
          aria-label="Fermer le scanner"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-sub)', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Boutons capture (uniquement si pas en cours) */}
      {status === 'idle' && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          {/* Caméra */}
          <div style={{ flex: 1 }}>
            <label
              htmlFor="ocr-camera"
              style={{
                ...S.btnGhost,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                gap:            8,
                cursor:         'pointer',
                padding:        '12px 16px',
                textAlign:      'center',
              }}
            >
              <span style={{ fontSize: 18 }}>📸</span>
              Prendre une photo
            </label>
            <input
              ref={cameraRef}
              id="ocr-camera"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              aria-label="Prendre une photo avec la caméra"
              style={{ display: 'none' }}
            />
          </div>

          {/* Galerie */}
          <div style={{ flex: 1 }}>
            <label
              htmlFor="ocr-gallery"
              style={{
                ...S.btnGhost,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                gap:            8,
                cursor:         'pointer',
                padding:        '12px 16px',
                textAlign:      'center',
              }}
            >
              <span style={{ fontSize: 18 }}>🖼️</span>
              Depuis la galerie
            </label>
            <input
              ref={galleryRef}
              id="ocr-gallery"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={handleFileChange}
              aria-label="Choisir une image depuis la galerie"
              style={{ display: 'none' }}
            />
          </div>
        </div>
      )}

      {/* Barre de progression */}
      {(isActive || isSuccess) && (
        <div style={{ marginBottom: 14 }}>
          <ProgressBar status={status} />
        </div>
      )}

      {/* Erreur format ou serveur */}
      {isError && !isInvalid && (
        <div
          id="ocr-error"
          role="alert"
          style={{ padding: '12px 14px', borderRadius: 10, background: '#fff5f5', border: '1px solid #ffcdd2', marginBottom: 14 }}
        >
          <div style={{ fontSize: 13, color: '#C62828', fontWeight: 600, marginBottom: 8 }}>
            ⚠️ {error}
          </div>
          <button onClick={handleReset} style={{ ...S.btnGhost, fontSize: 12, padding: '10px 14px' }}>
            Réessayer
          </button>
        </div>
      )}

      {/* Niveau 2 rejeté — pas un reçu */}
      {isInvalid && (
        <div
          id="ocr-invalid"
          role="alert"
          style={{ padding: '12px 14px', borderRadius: 10, background: '#FFF8E1', border: '1px solid #FFE082', marginBottom: 14 }}
        >
          <div style={{ fontSize: 13, color: '#E65100', fontWeight: 600, marginBottom: 10 }}>
            🔍 {error}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={handleReset} style={{ ...S.btnGhost, fontSize: 12, padding: '10px 14px' }}>
              Réessayer
            </button>
            <button
              onClick={handleManualEntry}
              style={{ ...S.btnDark, fontSize: 12, padding: '10px 14px' }}
            >
              Saisir manuellement
            </button>
          </div>
        </div>
      )}

      {/* Résultat — aperçu modifiable */}
      {isSuccess && editFields && (
        <div>
          {/* Avertissement confiance faible */}
          {(result?.raw?.needsManualReview || result?.transformed?._needsManualReview) && (
            <div
              aria-live="polite"
              style={{ padding: '8px 12px', borderRadius: 8, background: '#FFF8E1', border: '1px solid #FFE082', marginBottom: 12, fontSize: 12, color: '#E65100' }}
            >
              ⚠️ Confiance faible ({Math.round((result.raw.confidence || 0) * 100)}%) — vérifiez les données ci-dessous.
            </div>
          )}

          {/* Badge devise — warning si différente de MAD */}
          {editFields.currency && (
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                background: editFields.currency !== 'MAD' ? '#FFF8E1' : '#E8F5E9',
                color:      editFields.currency !== 'MAD' ? '#E65100' : '#2E7D32',
                border:     `1px solid ${editFields.currency !== 'MAD' ? '#FFE082' : '#C8E6C9'}`,
              }}>
                {editFields.currency !== 'MAD' ? '⚠️' : '✓'} Devise : {editFields.currency}
              </span>
              {editFields.currency !== 'MAD' && (
                <span style={{ fontSize: 11, color: '#E65100' }}>
                  — vérifiez le montant
                </span>
              )}
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: '#2E7D32', marginBottom: 12 }}>
            ✓ Reçu analysé — vérifiez et confirmez
          </div>

          {/* Champs obligatoires */}
          <ReviewField
            id="ocr-merchant"
            label="Commerçant"
            value={editFields.merchant}
            required
            onChange={v => setEditFields(f => ({ ...f, merchant: v, detail: v }))}
          />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
            <ReviewField
              id="ocr-total"
              label="Montant total"
              value={editFields.total}
              type="number"
              required
              onChange={v => setEditFields(f => ({ ...f, total: v, unit: v }))}
            />
            <ReviewField
              id="ocr-date"
              label="Date"
              value={editFields.date}
              required
              onChange={v => setEditFields(f => ({ ...f, date: v, comment: v ? `Reçu du ${v}` : '' }))}
            />
          </div>

          {/* Catégorie détectée automatiquement */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              Catégorie
              {editFields.categoryConfidence > 0 && editFields.categoryConfidence < 0.5 && (
                <span style={{ fontSize: 10, color: '#E65100', fontWeight: 600, textTransform: 'none' }}>— faible confiance, vérifiez</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                value={editFields.category}
                onChange={e => setEditFields(f => ({ ...f, category: e.target.value, subcategory: 'Autre' }))}
                style={{ ...S.input, flex: '1 1 140px' }}
              >
                {Object.keys(CATEGORIES).map(cat => (
                  <option key={cat} value={cat}>{CATEGORIES[cat].icon} {cat}</option>
                ))}
              </select>
              <select
                value={editFields.subcategory}
                onChange={e => setEditFields(f => ({ ...f, subcategory: e.target.value }))}
                style={{ ...S.input, flex: '1 1 120px' }}
              >
                {(CATEGORIES[editFields.category]?.subs || ['Autre']).map(sub => (
                  <option key={sub} value={sub}>{sub}</option>
                ))}
              </select>
            </div>
            {editFields.categoryMethod && editFields.categoryMethod !== 'none' && (
              <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 4 }}>
                {editFields.categoryMethod === 'claude' && '🤖 Détecté par Claude Vision'}
                {editFields.categoryMethod === 'google_labels' && '🔍 Détecté par Google Vision'}
                {editFields.categoryMethod?.startsWith('heuristic') && '⚙️ Détecté automatiquement — vérifiez'}
              </div>
            )}
          </div>

          {/* TVA — informatif si disponible */}
          {editFields.tax && (
            <div style={{
              fontSize: 12, color: 'var(--text-sub)', padding: '6px 10px',
              background: 'var(--hover-bg)', borderRadius: 8, marginBottom: 10,
              display: 'flex', gap: 8,
            }}>
              <span>TVA :</span>
              <strong style={{ color: 'var(--text)' }}>{editFields.tax}</strong>
              {editFields.subtotal && (
                <>
                  <span style={{ color: 'var(--border)' }}>·</span>
                  <span>HT :</span>
                  <strong style={{ color: 'var(--text)' }}>{editFields.subtotal}</strong>
                </>
              )}
            </div>
          )}

          <ReviewField
            id="ocr-comment"
            label="Commentaire (optionnel)"
            value={editFields.comment}
            onChange={v => setEditFields(f => ({ ...f, comment: v }))}
          />

          {/* Message si champs obligatoires manquants */}
          {!requiredOk && (
            <div style={{ fontSize: 11, color: '#E65100', marginBottom: 8 }}>
              Complétez les champs obligatoires (*) pour confirmer.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={handleConfirm}
              disabled={!requiredOk}
              style={{ ...S.btnDark, flex: 2, opacity: requiredOk ? 1 : 0.45, cursor: requiredOk ? 'pointer' : 'not-allowed' }}
            >
              ✓ Utiliser ces données
            </button>
            <button
              onClick={handleReset}
              style={{ ...S.btnGhost, flex: 1 }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Aide initiale */}
      {status === 'idle' && (
        <p style={{ fontSize: 11, color: 'var(--text-sub)', margin: 0, lineHeight: 1.5 }}>
          JPEG, PNG, WEBP ou HEIC · Max 4 Mo · Les données extraites seront pré-remplies dans le formulaire.
        </p>
      )}
    </div>
  );
}
