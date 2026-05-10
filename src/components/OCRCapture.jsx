// src/components/OCRCapture.jsx
// Composant de capture et traitement OCR — aucune logique SplitLy

import { useRef, useState } from 'react';
import { useOCRModule } from '../hooks/useOCRModule.jsx';
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
function ReviewField({ id, label, value, onChange, type = 'text' }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={id} style={S.label}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
        style={S.input}
      />
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────
export function OCRCapture({ onFill, onClose, isMobile }) {
  const cameraRef  = useRef(null);
  const galleryRef = useRef(null);

  // Champs éditables (pour review ou succès)
  const [editFields, setEditFields] = useState(null);

  const handleSuccess = (transformed, raw) => {
    // Pré-remplir les champs pour preview modifiable
    setEditFields({
      merchant: raw.merchant || '',
      total:    raw.total != null ? String(raw.total) : '',
      date:     raw.date  || '',
      detail:   transformed.detail,
      unit:     transformed.unit,
      comment:  transformed.comment,
    });
  };

  const handleInvalid = () => {
    // status='error' + error message already set in hook — nothing extra needed
  };

  const { scan, status, result, error, reset } = useOCRModule({
    adapter:   'receipt',
    onSuccess: handleSuccess,
    onInvalid: handleInvalid,
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
    // Reset input pour permettre de re-sélectionner le même fichier
    e.target.value = '';
  };

  const handleConfirm = () => {
    if (!editFields) return;
    onFill({
      detail:  editFields.detail,
      unit:    editFields.unit,
      qty:     1,
      comment: editFields.comment,
    });
  };

  const handleReset = () => {
    reset();
    setEditFields(null);
  };

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
          <button onClick={handleReset} style={{ ...S.btnGhost, fontSize: 12, padding: '6px 12px' }}>
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
            <button onClick={handleReset} style={{ ...S.btnGhost, fontSize: 12, padding: '6px 12px' }}>
              Réessayer
            </button>
            <button
              onClick={onClose}
              style={{ ...S.btnDark, fontSize: 12, padding: '6px 12px' }}
            >
              Saisir manuellement
            </button>
          </div>
        </div>
      )}

      {/* Résultat — aperçu modifiable */}
      {isSuccess && editFields && (
        <div>
          {result?.raw?.needsManualReview && (
            <div
              aria-live="polite"
              style={{ padding: '8px 12px', borderRadius: 8, background: '#FFF8E1', border: '1px solid #FFE082', marginBottom: 14, fontSize: 12, color: '#E65100' }}
            >
              ⚠️ Confiance faible ({Math.round((result.raw.confidence || 0) * 100)}%) — vérifiez les données ci-dessous.
            </div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, color: '#2E7D32', marginBottom: 12 }}>
            ✓ Reçu analysé — vérifiez et confirmez
          </div>

          <ReviewField
            id="ocr-merchant"
            label="Commerçant"
            value={editFields.merchant}
            onChange={v => setEditFields(f => ({ ...f, merchant: v, detail: v }))}
          />
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
            <ReviewField
              id="ocr-total"
              label="Montant total"
              value={editFields.total}
              type="number"
              onChange={v => setEditFields(f => ({ ...f, total: v, unit: v }))}
            />
            <ReviewField
              id="ocr-date"
              label="Date"
              value={editFields.date}
              onChange={v => setEditFields(f => ({ ...f, date: v, comment: v ? `Reçu du ${v}` : '' }))}
            />
          </div>
          <ReviewField
            id="ocr-comment"
            label="Commentaire (optionnel)"
            value={editFields.comment}
            onChange={v => setEditFields(f => ({ ...f, comment: v }))}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={handleConfirm}
              style={{ ...S.btnDark, flex: 2 }}
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
