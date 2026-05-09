// src/components/ui/index.jsx
import { useState, useEffect, useCallback } from "react";
import { AVATAR_EMOJIS } from "../../constants.js";
import { getAvatarMap, saveAvatarEmoji } from "../../utils.js";
import { S } from "../../styles.js";

// ─── HOOKS ────────────────────────────────────────────────────

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 768 : false);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
}

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  const removeToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, addToast, removeToast };
}

// ─── TOAST ────────────────────────────────────────────────────

export function ToastContainer({ toasts, removeToast }) {
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 2000, display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "success" ? "#2E7D32" : t.type === "error" ? "#C62828" : t.type === "warning" ? "#F57F17" : "#0F0F0F",
          color: "#fff", borderRadius: 12, padding: "12px 16px", fontSize: 13, fontFamily: "sans-serif",
          display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
          animation: "slideIn 0.2s ease",
        }}>
          <span style={{ fontSize: 16 }}>{t.type === "success" ? "✓" : t.type === "error" ? "✕" : t.type === "warning" ? "⚠️" : "ℹ"}</span>
          <span style={{ flex: 1 }}>{t.message}</span>
          <button onClick={() => removeToast(t.id)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
        </div>
      ))}
      <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}

// ─── AVATAR ───────────────────────────────────────────────────

export function Avatar({ name = "?", size = 32 }) {
  const colors = ["#2E7D32", "#1565C0", "#F57F17", "#6A1B9A", "#C62828", "#00695C", "#AD1457"];
  const avatarMap = getAvatarMap();
  const emoji = avatarMap[name];
  if (emoji) {
    return (
      <div style={{ width: size, height: size, borderRadius: "50%", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.55, flexShrink: 0, userSelect: "none", border: "1.5px solid #e0e0e0" }}>
        {emoji}
      </div>
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: colors[name.charCodeAt(0) % colors.length], color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4, fontWeight: 700, flexShrink: 0, userSelect: "none" }}>
      {name[0].toUpperCase()}
    </div>
  );
}

export function EmojiPicker({ name, onClose }) {
  const [selected, setSelected] = useState(getAvatarMap()[name] || null);
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1.5px solid #eee", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", maxWidth: 300, width: "100%" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Avatar pour <strong>{name}</strong></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 16 }}>
        {AVATAR_EMOJIS.map(e => (
          <button key={e} onClick={() => setSelected(e)} style={{ fontSize: 22, padding: 6, borderRadius: 10, border: `2px solid ${selected === e ? "#0F0F0F" : "#eee"}`, background: selected === e ? "#f0f0f0" : "transparent", cursor: "pointer" }}>
            {e}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => { if (selected) { saveAvatarEmoji(name, selected); } onClose(); }}
          style={{ flex: 1, padding: "8px", borderRadius: 10, background: "#0F0F0F", color: "#fff", border: "none", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
          ✓ Confirmer
        </button>
        <button onClick={() => { saveAvatarEmoji(name, null); onClose(); }}
          style={{ padding: "8px 12px", borderRadius: 10, background: "#fff5f5", color: "#C62828", border: "1.5px solid #ffcdd2", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
          Reset
        </button>
      </div>
      <button onClick={onClose} style={{ width: "100%", marginTop: 8, padding: "7px", borderRadius: 10, background: "transparent", color: "#aaa", border: "1px solid #eee", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
        Annuler
      </button>
    </div>
  );
}

export function AvatarStack({ names = [], size = 24 }) {
  const show = names.slice(0, 4);
  const rest = names.length - 4;
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {show.map((n, i) => (
        <div key={n} style={{ marginLeft: i > 0 ? -8 : 0, border: "2px solid #fff", borderRadius: "50%", flexShrink: 0 }} title={n}>
          <Avatar name={n} size={size} />
        </div>
      ))}
      {rest > 0 && (
        <div style={{ marginLeft: 4, width: size, height: size, borderRadius: "50%", background: "#e5e5e5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 700, color: "#888", border: "2px solid #fff" }}>
          +{rest}
        </div>
      )}
    </div>
  );
}

// ─── TYPOGRAPHY ───────────────────────────────────────────────

export function Truncate({ text, max = 30 }) {
  if (!text) return null;
  const truncated = text.length > max ? text.slice(0, max) + "…" : text;
  return <span title={text}>{truncated}</span>;
}

export function Badge({ label, color, accent }) {
  return <span style={{ background: color, color: accent, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, border: `1px solid ${accent}22`, whiteSpace: "nowrap", display: "inline-block" }}>{label}</span>;
}

// ─── LAYOUT ───────────────────────────────────────────────────

export function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: action ? 20 : 0, maxWidth: 280, margin: "0 auto" }}>{subtitle}</div>
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}

export function Spinner({ fullscreen = true }) {
  const content = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{ width: 40, height: 40, border: "3px solid #eee", borderTop: "3px solid #0F0F0F", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ fontSize: 13, color: "#aaa" }}>Chargement...</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
  if (!fullscreen) return content;
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f4f4f4" }}>{content}</div>;
}

export function StatCard({ label, value, sub, color, accent }) {
  return (
    <div style={{ background: "var(--stat-bg)", borderRadius: 14, padding: "18px 20px", border: "1px solid var(--border)", borderLeft: accent ? `4px solid ${accent}` : undefined }}>
      <div style={{ fontSize: 10, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'Playfair Display', serif", letterSpacing: -0.5, marginBottom: 4, color: "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{sub}</div>}
    </div>
  );
}

// ─── FORMS ────────────────────────────────────────────────────

export function Chip({ label, onRemove, color = "#0F0F0F" }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: color, color: "#fff", borderRadius: 20, padding: "4px 12px", fontSize: 13, maxWidth: 160 }}>
      <Avatar name={label} size={18} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {onRemove && <button onClick={onRemove} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>}
    </div>
  );
}

export function ParticipantInput({ participants, onChange }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const MAX = 30;
  const add = () => {
    const name = input.trim();
    if (!name) { setError("Le prénom ne peut pas être vide."); return; }
    if (name.length > 30) { setError("Maximum 30 caractères."); return; }
    if (participants.length >= MAX) { setError(`Maximum ${MAX} participants.`); return; }
    if (participants.map(p => p.toLowerCase()).includes(name.toLowerCase())) { setError("Déjà dans la liste."); return; }
    onChange([...participants, name]); setInput(""); setError("");
  };
  return (
    <div>
      <label style={S.label}>Participants (min. 2)</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input style={{ ...S.input, flex: 1 }} placeholder="Tapez un prénom puis +" value={input}
          onChange={e => { setInput(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && add()} />
        <button onClick={add} style={{ ...S.btnDark, padding: "9px 16px", borderRadius: 8, flexShrink: 0 }}>+</button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#C62828", marginBottom: 8 }}>⚠️ {error}</div>}
      {participants.length === 0 && <div style={{ fontSize: 12, color: "#aaa", padding: "10px 0" }}>Aucun participant ajouté</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {participants.map(p => <Chip key={p} label={p} onRemove={() => onChange(participants.filter(x => x !== p))} />)}
      </div>
      {participants.length > 0 && participants.length < 2 && <div style={{ fontSize: 12, color: "#F57F17", marginTop: 8 }}>⚠️ Minimum 2 participants requis</div>}
      {participants.length >= MAX && <div style={{ fontSize: 12, color: "#C62828", marginTop: 8 }}>⚠️ Maximum {MAX} participants atteint</div>}
      <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>{participants.length}/{MAX} participants</div>
    </div>
  );
}

export function ParticipantToggle({ people, selected, onChange, label }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <label style={S.label}>{label}</label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onChange([...people])} style={{ fontSize: 11, color: "#1565C0", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Tous</button>
          <button onClick={() => onChange([])} style={{ fontSize: 11, color: "#C62828", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Aucun</button>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {people.map(p => {
          const sel = selected.includes(p);
          return (
            <button key={p} onClick={() => onChange(sel ? selected.filter(x => x !== p) : [...selected, p])}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${sel ? "#0F0F0F" : "#e0e0e0"}`, background: sel ? "#0F0F0F" : "#fff", color: sel ? "#fff" : "#555", cursor: "pointer", fontSize: 12.5, fontWeight: 500, transition: "all 0.15s" }}>
              <Avatar name={p} size={18} />
              <span style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
              {sel && <span style={{ fontSize: 10, opacity: 0.7 }}>✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── MODALS ───────────────────────────────────────────────────

export function Modal({ title, onClose, children, size = 500 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "var(--bg-secondary)", borderRadius: 18, padding: 28, width: "100%", maxWidth: size, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.35)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>{title}</div>
          <button onClick={onClose} style={{ background: "var(--hover-bg)", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({ message, warnings = [], onConfirm, onCancel, confirmOnly = false }) {
  return (
    <Modal title={confirmOnly ? "⚠️ Action impossible" : "Confirmer l'action"} onClose={onCancel}>
      <p style={{ fontSize: 14, color: "var(--text)", marginBottom: 14, lineHeight: 1.5 }}>{message}</p>
      {warnings.map((w, i) => <div key={i} style={{ background: confirmOnly ? "#FFEBEE" : "#FFF8E1", border: `1px solid ${confirmOnly ? "#FFCDD2" : "#F57F17"}`, borderRadius: 8, padding: "9px 14px", fontSize: 12, color: confirmOnly ? "#C62828" : "#E65100", marginBottom: 8 }}>⚠️ {w}</div>)}
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        {!confirmOnly && <button onClick={onConfirm} style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex" }}>Confirmer</button>}
        <button onClick={onCancel} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>{confirmOnly ? "Fermer" : "Annuler"}</button>
      </div>
    </Modal>
  );
}
