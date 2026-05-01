import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import LandingPage from "./LandingPage.jsx";
import { useTranslation, LanguageSwitcher, LanguageMenu } from "./i18n.jsx";
import {
  supabase, signUp, signIn, signOut, getSession,
  fetchEvents, createEvent, updateEventStatus, deleteEvent,
  addParticipant, removeParticipant,
  fetchExpenses, createExpense, updateExpense, deleteExpense,
  fetchContributions, upsertContribution, recordPayment, fetchPayments,
  fetchHistory, invalidateHistory,
  fetchNotifications, markAllNotificationsRead, deleteNotification,
  fetchInvitations, sendInvitation, removeInvitation, updateInvitationRole,
  submitPendingAction, fetchAllPendingActions, approvePendingAction, rejectPendingAction,
  sendGuestCode, verifyGuestCode,
  subscribeToNotifications, unsubscribe,
  exportPDF,
  fetchProfile, fetchAdminUsers, adminUserAction,
} from "./supabase.js";

// ─── CONSTANTES ───────────────────────────────────────────────
const CATEGORIES = {
  "Nourriture":           { icon: "🍽️", color: "#E8F5E9", accent: "#2E7D32",  subs: ["Entrée", "Plat", "Dessert", "Autre"] },
  "Boisson":              { icon: "🥤", color: "#E3F2FD", accent: "#1565C0",  subs: ["Alcool", "Jus", "Eau", "Autre"] },
  "Transport":            { icon: "🚖", color: "#FFF8E1", accent: "#F57F17",  subs: ["Taxi", "Tram", "Bus", "Train", "Avion", "Autre"] },
  "Accessoires":          { icon: "🎉", color: "#F3E5F5", accent: "#6A1B9A",  subs: ["Décoration", "Fournitures", "Équipement", "Autre"] },
  "Hébergement":          { icon: "🏨", color: "#E0F7FA", accent: "#00695C",  subs: ["Hôtel", "Airbnb", "Auberge", "Autre"] },
  "Loisirs & Activités":  { icon: "🎭", color: "#FCE4EC", accent: "#AD1457",  subs: ["Cinéma", "Concert", "Musée", "Autre"] },
  "Courses & Épicerie":   { icon: "🛒", color: "#F1F8E9", accent: "#558B2F",  subs: ["Supermarché", "Marché", "Boulangerie", "Autre"] },
  "Loyer & Factures":     { icon: "💡", color: "#FFFDE7", accent: "#F9A825",  subs: ["Loyer", "Électricité", "Internet", "Autre"] },
  "Cadeaux":              { icon: "🎁", color: "#FBE9E7", accent: "#BF360C",  subs: ["Anniversaire", "Mariage", "Naissance", "Autre"] },
  "Santé & Bien-être":    { icon: "💊", color: "#E8EAF6", accent: "#283593",  subs: ["Médecin", "Pharmacie", "Salle de sport", "Autre"] },
  "Technologie & Services":{ icon: "📱", color: "#ECEFF1", accent: "#455A64", subs: ["Abonnement", "Logiciel", "Appareil", "Autre"] },
  "Autre":                { icon: "❓", color: "#F5F5F5", accent: "#757575",  subs: ["Autre"] },
};
const CURRENCIES = ["EUR €", "USD $", "GBP £", "XOF FCFA", "MAD DH", "CAD $"];

// ─── HOOKS ────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
}

// ─── TOAST SYSTEM ─────────────────────────────────────────────
function ToastContainer({ toasts, removeToast }) {
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

function useToast() {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  const removeToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, addToast, removeToast };
}

// ─── LOGIQUE MÉTIER ───────────────────────────────────────────
const currencySymbol = (c) => c?.split(" ")[1] || "€";

// Séparateur de milliers + 2 décimales
function fmt(amount, sym = "") {
  const n = Number(amount) || 0;
  const parts = n.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0"); // espace insécable
  return sym ? `${parts.join(".")} ${sym}` : parts.join(".");
}

function computeOwed(expenses, person) {
  return expenses.reduce((sum, ex) => {
    const inc = ex.included || [];
    if (!inc.includes(person)) return sum;
    return sum + (ex.qty * (ex.unit_price ?? 0)) / inc.length;
  }, 0);
}

function computeNetBalance(expenses, contributions, person) {
  return (contributions[person] || 0) - computeOwed(expenses, person);
}

// Soldé strictement = écart ≤ 1 unité de monnaie
const isSettled = (net) => Math.abs(net) <= 1;
// Soldé exactement = écart = 0 (pour les messages)
const isExactlySettled = (net) => Math.abs(net) < 0.01;

// Statut solde lisible
function settleStatus(net, hasCharges) {
  if (!hasCharges) return { label: "—", color: "#aaa", bg: "#f5f5f5" };
  if (isExactlySettled(net)) return { label: "✓ Soldé", color: "#2E7D32", bg: "#E8F5E9" };
  if (isSettled(net)) return { label: "≈ Quasi soldé", color: "#2E7D32", bg: "#E8F5E9" };
  if (net > 0) return { label: `+${fmt(net)} à recevoir`, color: "#1565C0", bg: "#E3F2FD" };
  return { label: `${fmt(net)} à payer`, color: "#C62828", bg: "#fff5f5" };
}

// Validation montant
function validateAmount(qty, unit) {
  const q = Number(qty);
  const u = Number(unit);
  if (!qty || q <= 0) return "La quantité doit être supérieure à 0.";
  if (!Number.isInteger(q)) return "La quantité doit être un nombre entier.";
  if (q > 10000) return "La quantité ne peut pas dépasser 10 000.";
  if (!unit || u <= 0) return "Le prix unitaire doit être supérieur à 0.";
  if (u > 99999) return "Le prix unitaire ne peut pas dépasser 99 999.";
  if (q * u > 99999) return "Le montant total ne peut pas dépasser 99 999 (5 chiffres).";
  return null;
}

function computeTransactions(expenses, contributions, participants) {
  const nets = {};
  participants.forEach(p => { nets[p] = computeNetBalance(expenses, contributions, p); });
  const creditors = [], debtors = [];
  Object.entries(nets).forEach(([p, v]) => {
    if (v > 1) creditors.push({ p, v });
    else if (v < -1) debtors.push({ p, v: -v });
  });
  creditors.sort((a, b) => b.v - a.v);
  debtors.sort((a, b) => b.v - a.v);
  const txns = [];
  let i = 0, j = 0;
  while (i < creditors.length && j < debtors.length) {
    const amount = Math.min(creditors[i].v, debtors[j].v);
    if (amount > 0.01) txns.push({ from: debtors[j].p, to: creditors[i].p, amount });
    creditors[i].v -= amount; debtors[j].v -= amount;
    if (creditors[i].v <= 0.01) i++;
    if (debtors[j].v <= 0.01) j++;
  }
  return txns;
}

// ─── UI COMPONENTS ────────────────────────────────────────────

// ─── EMOJI AVATARS ────────────────────────────────────────────
const AVATAR_EMOJIS = ["😀","😎","🥳","🤩","🦁","🐯","🐻","🦊","🐼","🐨","🦄","🐸","🦋","🌟","⚡","🔥","🌈","🎯","🎸","🚀","💎","🌺","🍀","🎭","👑"];
const AVATAR_STORAGE_KEY = "splitly_avatars";

function getAvatarMap() {
  try { return JSON.parse(localStorage.getItem(AVATAR_STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveAvatarEmoji(name, emoji) {
  const map = getAvatarMap();
  if (emoji === null) { delete map[name]; } else { map[name] = emoji; }
  try { localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(map)); } catch {}
}

function Avatar({ name = "?", size = 32 }) {
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

function EmojiPicker({ name, onClose }) {
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

function Badge({ label, color, accent }) {
  return <span style={{ background: color, color: accent, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, border: `1px solid ${accent}22`, whiteSpace: "nowrap", display: "inline-block" }}>{label}</span>;
}

function AvatarStack({ names = [], size = 24 }) {
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

function Truncate({ text, max = 30 }) {
  if (!text) return null;
  const truncated = text.length > max ? text.slice(0, max) + "…" : text;
  return <span title={text}>{truncated}</span>;
}

function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 24px" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: action ? 20 : 0, maxWidth: 280, margin: "0 auto" }}>{subtitle}</div>
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}

function Chip({ label, onRemove, color = "#0F0F0F" }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: color, color: "#fff", borderRadius: 20, padding: "4px 12px", fontSize: 13, maxWidth: 160 }}>
      <Avatar name={label} size={18} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {onRemove && <button onClick={onRemove} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>}
    </div>
  );
}

function ParticipantInput({ participants, onChange }) {
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

function ParticipantToggle({ people, selected, onChange, label }) {
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

function Modal({ title, onClose, children, size = 500 }) {
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

function ConfirmModal({ message, warnings = [], onConfirm, onCancel }) {
  return (
    <Modal title="Confirmer l'action" onClose={onCancel}>
      <p style={{ fontSize: 14, color: "#444", marginBottom: 14, lineHeight: 1.5 }}>{message}</p>
      {warnings.map((w, i) => <div key={i} style={{ background: "#FFF8E1", border: "1px solid #F57F17", borderRadius: 8, padding: "9px 14px", fontSize: 12, color: "#E65100", marginBottom: 8 }}>⚠️ {w}</div>)}
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button onClick={onConfirm} style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex" }}>Confirmer</button>
        <button onClick={onCancel} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
      </div>
    </Modal>
  );
}

function Spinner({ fullscreen = true }) {
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

function StatCard({ label, value, sub, color, accent }) {
  return (
    <div style={{ background: "var(--stat-bg)", borderRadius: 14, padding: "18px 20px", border: "1px solid var(--border)", borderLeft: accent ? `4px solid ${accent}` : undefined }}>
      <div style={{ fontSize: 10, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'Playfair Display', serif", letterSpacing: -0.5, marginBottom: 4, color: "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{sub}</div>}
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────
function AuthScreen({ onAuth, onGuestAuth, initialMode, onClose }) {
  const [mode, setMode] = useState(initialMode || "login");
  const [form, setForm] = useState({ email: "", password: "", name: "", code: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAdmin = async () => {
    setLoading(true); setError("");
    if (mode === "login") {
      const { data, error } = await signIn(form.email, form.password);
      if (error) setError(error.message);
      else onAuth(data.user);
    } else {
      const { error } = await signUp(form.email, form.password, form.name);
      if (error) setError(error.message);
      else setMode("confirm");
    }
    setLoading(false);
  };

  const handleGuestRequest = async () => {
    if (!form.email) { setError("Entrez votre email."); return; }
    setLoading(true); setError("");
    const { data: invites } = await supabase.from('invitations').select('*').eq('email', form.email);
    if (!invites || invites.length === 0) { setError("Aucune invitation trouvée pour cet email."); setLoading(false); return; }
    await sendGuestCode(form.email, null);
    setMode("guest_verify");
    setLoading(false);
  };

  const handleGuestVerify = async () => {
    setLoading(true); setError("");
    const { valid } = await verifyGuestCode(form.email, form.code);
    if (!valid) { setError("Code incorrect. Vérifiez et réessayez."); setLoading(false); return; }
    await supabase.from('invitations').update({ status: 'accepted' }).eq('email', form.email).eq('status', 'pending');
    onGuestAuth(form.email);
    setLoading(false);
  };

  if (mode === "confirm") return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "linear-gradient(135deg, #f8f8f8 0%, #efefef 100%)", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 40, width: "100%", maxWidth: 380, textAlign: "center", boxShadow: "0 8px 40px rgba(0,0,0,0.1)" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10, fontFamily: "'Playfair Display', serif" }}>Vérifiez votre email</div>
        <p style={{ color: "#888", fontSize: 14, lineHeight: 1.6 }}>Un lien de confirmation a été envoyé à <strong>{form.email}</strong>.</p>
        <button onClick={() => setMode("login")} style={{ ...S.btnDark, marginTop: 24, width: "100%", justifyContent: "center", display: "flex" }}>Se connecter</button>
      </div>
    </div>
  );

  const isGuest = mode === "guest" || mode === "guest_verify";

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "linear-gradient(135deg, #f8f8f8 0%, #efefef 100%)", padding: 16 }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ background: "#fff", borderRadius: 20, padding: 36, width: "100%", maxWidth: 400, boxShadow: "0 8px 40px rgba(0,0,0,0.1)" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          {onClose && (
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#aaa", fontSize: 13, cursor: "pointer", marginBottom: 12, display: "flex", alignItems: "center", gap: 4, margin: "0 auto 12px" }}>
              ← Retour à l'accueil
            </button>
          )}
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 700, letterSpacing: -1 }}>SplitLy</div>
          <div style={{ color: "#aaa", fontSize: 13, marginTop: 4 }}>Gestion de dépenses partagées</div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", background: "#f5f5f5", borderRadius: 12, padding: 4, marginBottom: 24, gap: 4 }}>
          <button onClick={() => { setMode("login"); setError(""); }} style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", background: !isGuest ? "#0F0F0F" : "transparent", color: !isGuest ? "#fff" : "#666", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}>
            🔑 Admin
          </button>
          <button onClick={() => { setMode("guest"); setError(""); }} style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", background: isGuest ? "#0F0F0F" : "transparent", color: isGuest ? "#fff" : "#666", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}>
            👤 Invité
          </button>
        </div>

        {/* Admin forms */}
        {!isGuest && (
          <>
            {mode === "register" && (
              <div style={{ marginBottom: 14 }}>
                <label style={S.label}>Nom complet</label>
                <input style={S.input} placeholder="Alice Martin" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Email</label>
              <input style={S.input} type="email" placeholder="alice@mail.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Mot de passe</label>
              <input style={S.input} type="password" placeholder="••••••••" value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                onKeyDown={e => e.key === "Enter" && handleAdmin()} />
            </div>
            {error && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#C62828", marginBottom: 14 }}>⚠️ {error}</div>}
            <button onClick={handleAdmin} disabled={loading} style={{ ...S.btnDark, width: "100%", justifyContent: "center", display: "flex", opacity: loading ? 0.7 : 1 }}>
              {loading ? "Connexion..." : mode === "login" ? "Se connecter" : "Créer le compte"}
            </button>
            <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "#aaa" }}>
              {mode === "login" ? "Pas de compte ? " : "Déjà un compte ? "}
              <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
                style={{ background: "none", border: "none", color: "#0F0F0F", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                {mode === "login" ? "S'inscrire" : "Se connecter"}
              </button>
            </div>
          </>
        )}

        {/* Guest step 1 */}
        {mode === "guest" && (
          <>
            <div style={{ background: "#E3F2FD", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#1565C0", lineHeight: 1.5 }}>
              Entrez votre email pour recevoir un code d'accès à usage unique.
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Votre email</label>
              <input style={S.input} type="email" placeholder="votre@email.com" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                onKeyDown={e => e.key === "Enter" && handleGuestRequest()} />
            </div>
            {error && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#C62828", marginBottom: 14 }}>⚠️ {error}</div>}
            <button onClick={handleGuestRequest} disabled={loading} style={{ ...S.btnDark, width: "100%", justifyContent: "center", display: "flex", opacity: loading ? 0.7 : 1 }}>
              {loading ? "Envoi..." : "Recevoir le code →"}
            </button>
          </>
        )}

        {/* Guest step 2 */}
        {mode === "guest_verify" && (
          <>
            <div style={{ background: "#E8F5E9", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#2E7D32", lineHeight: 1.5 }}>
              Code envoyé à <strong>{form.email}</strong>. Vérifiez votre boîte mail.
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Code d'accès (6 chiffres)</label>
              <input style={{ ...S.input, fontSize: 24, letterSpacing: 8, textAlign: "center", fontWeight: 700 }}
                placeholder="000000" maxLength={6} value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })}
                onKeyDown={e => e.key === "Enter" && handleGuestVerify()} />
            </div>
            {error && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#C62828", marginBottom: 14 }}>⚠️ {error}</div>}
            <button onClick={handleGuestVerify} disabled={loading} style={{ ...S.btnDark, width: "100%", justifyContent: "center", display: "flex", opacity: loading ? 0.7 : 1 }}>
              {loading ? "Vérification..." : "Accéder →"}
            </button>
            <button onClick={() => { setMode("guest"); setError(""); }} style={{ ...S.btnGhost, width: "100%", justifyContent: "center", display: "flex", marginTop: 8 }}>← Retour</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── GUEST VIEW ───────────────────────────────────────────────
function GuestView({ guestEmail, onSignOut, isMobile, addToast }) {
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contributions, setContributions] = useState({});
  const [active, setActive] = useState("events");
  const [loading, setLoading] = useState(true);
  const [pendingForm, setPendingForm] = useState(false); // false | "add" | "edit"
  const [saving, setSaving] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [selectedEventPdf, setSelectedEventPdf] = useState("");

  const loadGuest = useCallback(async () => {
    setLoading(true);
    const { data: invitations } = await supabase.from('invitations').select('event_id, role, status').eq('email', guestEmail);
    if (!invitations || invitations.length === 0) { setLoading(false); return; }
    const eventIds = invitations.map(i => i.event_id);
    const { data: evData } = await supabase.from('events').select('*, event_participants(name)').in('id', eventIds);
    if (!evData) { setLoading(false); return; }
    setEvents(evData);
    const allExp = [], allContrib = {};
    for (const ev of evData) {
      const { data: exData } = await supabase.from('expenses').select('*').eq('event_id', ev.id);
      if (exData) allExp.push(...exData);
      const { data: cData } = await supabase.from('contributions').select('*').eq('event_id', ev.id);
      if (cData) { allContrib[ev.id] = {}; cData.forEach(c => { allContrib[ev.id][c.participant] = c.amount; }); }
    }
    setExpenses(allExp); setContributions(allContrib); setLoading(false);
  }, [guestEmail]);

  useEffect(() => { loadGuest(); }, [loadGuest]);

  const handleRequestAction = async (actionType, actionData, eventId) => {
    setSaving(true);
    await submitPendingAction({ eventId, guestEmail, actionType, actionData });
    setSaving(false); setPendingForm(false);
    addToast("Demande envoyée à l'admin. Elle sera exécutée dès approbation.", "info");
  };

  if (loading) return <Spinner />;

  const navItems = [
    { key: "events", icon: "◉", label: "Événements" },
    { key: "expenses", icon: "◫", label: "Charges" },
    { key: "balance", icon: "⊜", label: "Répartition" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#f4f4f4" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ background: "#0F0F0F", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: "#fff", cursor: "pointer" }} onClick={() => setActive("events")}>SplitLy</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: "#1565C0", color: "#fff", fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>👤 Invité</span>
          {!isMobile && <span style={{ color: "#666", fontSize: 12 }}>{guestEmail}</span>}
          <button onClick={onSignOut} style={{ background: "none", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "5px 12px", borderRadius: 8, cursor: "pointer" }}>Quitter</button>
        </div>
      </div>

      <div style={{ background: "#fff", borderBottom: "1px solid #eee", display: "flex", overflowX: "auto", position: "sticky", top: 56, zIndex: 99 }}>
        {navItems.map(n => (
          <button key={n.key} onClick={() => setActive(n.key)} style={{ padding: "14px 20px", border: "none", background: "none", fontSize: 13, fontWeight: active === n.key ? 700 : 400, color: active === n.key ? "#0F0F0F" : "#888", cursor: "pointer", borderBottom: active === n.key ? "2px solid #0F0F0F" : "2px solid transparent", whiteSpace: "nowrap", transition: "all 0.15s" }}>
            {n.icon} {n.label}
          </button>
        ))}
      </div>

      <main style={{ flex: 1, padding: isMobile ? "20px 16px 32px" : "28px 32px", maxWidth: 860, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ background: "#E3F2FD", border: "1px solid #90CAF9", borderRadius: 12, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#1565C0" }}>
          👁 Mode consultation. Pour ajouter une charge, soumettez une demande à l'admin.
        </div>

        {active === "events" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700 }}>Événements partagés</h2>
              {events.length > 0 && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    style={{ ...S.input, width: "auto", fontSize: 12 }}
                    value={selectedEventPdf}
                    onChange={e => setSelectedEventPdf(e.target.value)}
                  >
                    <option value="">Choisir un événement...</option>
                    {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                  </select>
                  <button
                    disabled={!selectedEventPdf}
                    onClick={() => {
                      const ev = events.find(e => e.id === selectedEventPdf);
                      if (!ev) return;
                      const evExp = expenses.filter(e => e.event_id === selectedEventPdf);
                      const evContribs = contributions[selectedEventPdf] || {};
                      const participants = (ev.event_participants || []).map(p => p.name);
                      exportPDF(ev, evExp, evContribs, participants);
                    }}
                    style={{ ...S.btnDark, opacity: !selectedEventPdf ? 0.5 : 1, whiteSpace: "nowrap" }}
                  >
                    📄 PDF
                  </button>
                </div>
              )}
            </div>
            {events.length === 0 ? (
              <EmptyState icon="🎊" title="Aucun événement" subtitle="Aucun événement n'a encore été partagé avec vous." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {events.map(ev => {
                  const participants = (ev.event_participants || []).map(p => p.name);
                  const evTotal = expenses.filter(e => e.event_id === ev.id).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
                  return (
                    <div key={ev.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 20px", border: "1px solid #eee", display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ fontSize: 28, flexShrink: 0 }}>{ev.status === "closed" ? "🔒" : "🎊"}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</div>
                        <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>📅 {ev.date} · {currencySymbol(ev.currency)}</div>
                        <AvatarStack names={participants} size={22} />
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{fmt(evTotal, currencySymbol(ev.currency))}</div>
                        <div style={{ fontSize: 11, color: "#aaa" }}>budget collectif</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {active === "expenses" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700 }}>Charges</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setPendingForm(pendingForm === "add" ? false : "add")} style={S.btnDark}>➕ Demander ajout</button>
              </div>
            </div>

            {/* Formulaire ajout */}
            {pendingForm === "add" && (
              <GuestExpenseForm events={events} onSubmit={handleRequestAction} onCancel={() => setPendingForm(false)} saving={saving} />
            )}

            {/* Formulaire modification */}
            {pendingForm === "edit" && editingExpense && (
              <GuestEditExpenseForm
                expense={editingExpense}
                events={events}
                onSubmit={async (data) => {
                  await handleRequestAction("modify_expense", { ...data, expense_id: editingExpense.id }, editingExpense.event_id);
                  setEditingExpense(null);
                }}
                onCancel={() => { setPendingForm(false); setEditingExpense(null); }}
                saving={saving}
              />
            )}

            {expenses.length === 0 ? (
              <EmptyState icon="🧾" title="Aucune charge" subtitle="Aucune dépense n'a encore été enregistrée." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {expenses.map(ex => {
                  const cat = CATEGORIES[ex.category];
                  const ev = events.find(e => e.id === ex.event_id);
                  const total = ex.qty * (ex.unit_price ?? 0);
                  const inc = ex.included || [];
                  const share = inc.length > 0 ? total / inc.length : 0;
                  const sym = currencySymbol(ev?.currency);
                  return (
                    <div key={ex.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", border: "1px solid #eee" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <span style={{ fontSize: 22, flexShrink: 0 }}>{cat?.icon}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail}</div>
                            <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                              {ev?.name} · {ex.is_unpaid ? <span style={{ color: "#F57F17", fontWeight: 600 }}>⏳ Non réglée</span> : `par ${ex.paid_by}`}
                            </div>
                            {ex.comment && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic", marginTop: 2 }}>💬 {ex.comment}</div>}
                            {cat && <div style={{ marginTop: 4 }}><Badge label={ex.sub_category} color={cat.color} accent={cat.accent} /></div>}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(total, sym)}</div>
                          <div style={{ fontSize: 11, color: "#2E7D32", fontWeight: 600 }}>{fmt(share, sym)}/p.</div>
                          {ev?.status === "open" && (
                            <button
                              onClick={() => { setEditingExpense(ex); setPendingForm("edit"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                              style={{ marginTop: 6, padding: "3px 10px", borderRadius: 8, border: "1.5px solid #e0e0e0", background: "#fafafa", fontSize: 11, cursor: "pointer", color: "#555", fontWeight: 600 }}
                            >
                              ✏️ Demander modification
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {active === "balance" && (
          <GuestBalance events={events} expenses={expenses} contributions={contributions} />
        )}
      </main>
    </div>
  );
}

function GuestExpenseForm({ events, onSubmit, onCancel, saving }) {
  const empty = { eventId: "", category: "", sub: "", detail: "", qty: 1, unit: "", paidBy: "", included: [] };
  const [form, setForm] = useState(empty);
  const handleEventChange = (evId) => {
    const ev = events.find(e => e.id === evId);
    const participants = (ev?.event_participants || []).map(p => p.name);
    setForm(f => ({ ...f, eventId: evId, paidBy: "", included: [...participants] }));
  };
  const currentEvent = events.find(e => e.id === form.eventId);
  const participants = (currentEvent?.event_participants || []).map(p => p.name);
  const total = (Number(form.qty) || 0) * (Number(form.unit) || 0);

  return (
    <div style={{ ...S.card, border: "1.5px solid #1565C0", marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, color: "#1565C0" }}>📝 Demande d'ajout de charge</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div><label style={S.label}>Événement</label>
          <select style={S.input} value={form.eventId} onChange={e => handleEventChange(e.target.value)}>
            <option value="">Sélectionner...</option>
            {events.filter(e => e.status === "open").map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        </div>
        <div><label style={S.label}>Payé par</label>
          <select style={S.input} value={form.paidBy} onChange={e => setForm({ ...form, paidBy: e.target.value })} disabled={!currentEvent}>
            <option value="">Sélectionner...</option>
            {participants.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div><label style={S.label}>Catégorie</label>
          <select style={S.input} value={form.category} onChange={e => setForm({ ...form, category: e.target.value, sub: "" })}>
            <option value="">Sélectionner...</option>
            {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{CATEGORIES[c].icon} {c}</option>)}
          </select>
        </div>
        <div><label style={S.label}>Sous-catégorie</label>
          <select style={S.input} value={form.sub} onChange={e => setForm({ ...form, sub: e.target.value })} disabled={!form.category}>
            <option value="">Sélectionner...</option>
            {form.category && CATEGORIES[form.category].subs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}><label style={S.label}>Détail</label><input style={S.input} placeholder="Ex: Vin rouge, Salade César..." value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div><label style={S.label}>Quantité</label><input type="number" min="1" style={S.input} value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
        <div><label style={S.label}>Prix unitaire</label><input type="number" min="0" step="0.01" style={S.input} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
        <div><label style={S.label}>Total</label><div style={{ ...S.input, background: "#f0faf4", color: "#2E7D32", fontWeight: 700, display: "flex", alignItems: "center" }}>{total.toFixed(2)}</div></div>
      </div>
      {currentEvent && <div style={{ marginBottom: 14 }}><ParticipantToggle people={participants} selected={form.included} onChange={p => setForm({ ...form, included: p })} label="Qui partage ?" /></div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onSubmit("add_expense", { ...form, qty: Number(form.qty), unit: Number(form.unit) }, form.eventId)}
          disabled={saving || !form.eventId || !form.detail || total === 0} style={{ ...S.btnDark, opacity: (!form.eventId || !form.detail || total === 0) ? 0.5 : 1 }}>
          {saving ? "Envoi..." : "Soumettre"}
        </button>
        <button onClick={onCancel} style={S.btnGhost}>Annuler</button>
      </div>
    </div>
  );
}

function GuestBalance({ events, expenses, contributions }) {
  const [sel, setSel] = useState(events[0]?.id || "");
  const ev = events.find(e => e.id === sel);
  const evExp = expenses.filter(e => e.event_id === sel);
  const sym = currencySymbol(ev?.currency);
  const participants = (ev?.event_participants || []).map(p => p.name);
  const evContribMap = contributions[sel] || {};
  const transactions = participants.length > 0 ? computeTransactions(evExp, evContribMap, participants) : [];

  return (
    <div>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Répartition</h2>
      {events.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {events.map(ev => <button key={ev.id} onClick={() => setSel(ev.id)} style={{ padding: "6px 14px", borderRadius: 20, border: `1.5px solid ${sel === ev.id ? "#0F0F0F" : "#ddd"}`, background: sel === ev.id ? "#0F0F0F" : "#fff", color: sel === ev.id ? "#fff" : "#555", fontSize: 12, cursor: "pointer" }}>{ev.name}</button>)}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
        {participants.map(p => {
          const owed = computeOwed(evExp, p);
          const contrib = evContribMap[p] || 0;
          const net = contrib - owed;
          const settled = isSettled(net);
          return (
            <div key={p} style={{ background: "#fff", borderRadius: 14, padding: "16px 12px", border: `2px solid ${settled ? "#c8e6c9" : "#eee"}`, textAlign: "center" }}>
              <Avatar name={p} size={36} />
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</div>
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 3 }}>Doit: {fmt(owed, sym)}</div>
              <div style={{ marginTop: 6, padding: "4px 6px", borderRadius: 8, background: settleStatus(net, owed > 0).bg, fontSize: 12, fontWeight: 700, color: settleStatus(net, owed > 0).color }}>
                {settleStatus(net, owed > 0).label}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0f0", fontSize: 14, fontWeight: 700 }}>Remboursements ({transactions.length})</div>
        {transactions.length === 0 ? <EmptyState icon="✅" title="Tout est soldé !" subtitle="Aucun remboursement à effectuer." /> : (
          transactions.map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: i < transactions.length - 1 ? "1px solid #f5f5f5" : "none" }}>
              <Avatar name={t.from} size={28} />
              <div style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}><Truncate text={t.from} max={12} /></span>
                <span style={{ color: "#aaa" }}> → </span>
                <span style={{ fontWeight: 600 }}><Truncate text={t.to} max={12} /></span>
              </div>
              <Avatar name={t.to} size={28} />
              <div style={{ fontSize: 15, fontWeight: 700, flexShrink: 0 }}>{fmt(t.amount, sym)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────
function Sidebar({ active, setActive, unreadCount, pendingCount, user, onSignOut, isMobile, menuOpen, setMenuOpen, t, lang, setLang, searchQuery, setSearchQuery, isAdmin }) {
  const totalBadge = unreadCount + pendingCount;
  const nav = [
    { key: "dashboard",     icon: "◈", label: t("nav_dashboard") },
    { key: "events",        icon: "◉", label: t("nav_events") },
    { key: "expenses",      icon: "◫", label: t("nav_expenses") },
    { key: "balance",       icon: "⊜", label: t("nav_balance") },
    { key: "analytics",     icon: "◐", label: t("nav_analytics") },
    { key: "history",       icon: "◷", label: t("nav_history") },
    { key: "invite",        icon: "◎", label: t("nav_invite") },
    { key: "notifications", icon: "◬", label: t("nav_notifications"), badge: totalBadge },
    { key: "settings",      icon: "⚙", label: t("nav_settings") || "Paramètres" },
    ...(isAdmin ? [{ key: "superadmin", icon: "⚡", label: "Super Admin" }] : []),
  ];

  const SHORTCUTS = {
    dashboard: "D", events: "E", expenses: "X",
    balance: "B", analytics: "A", history: "H",
    invite: "I", notifications: "N",
  };

  const NavButton = ({ n }) => (
    <button onClick={() => { setActive(n.key); if (isMobile) setMenuOpen(false); }}
      title={`${n.label} (G+${SHORTCUTS[n.key]})`}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: active === n.key ? "#1a1a1a" : "transparent", color: active === n.key ? "#fff" : "#777", fontSize: 13, fontWeight: active === n.key ? 600 : 400, textAlign: "left", width: "100%", transition: "all 0.2s", minWidth: 0, position: "relative" }}>
      {/* Indicateur actif animé */}
      {active === n.key && (
        <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 20, background: "#fff", borderRadius: "0 3px 3px 0", transition: "all 0.2s" }} />
      )}
      <span style={{ fontSize: 15, opacity: active === n.key ? 1 : 0.5, flexShrink: 0, transition: "all 0.2s" }}>{n.icon}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{n.label}</span>
      {!isMobile && active !== n.key && (
        <span style={{ fontSize: 9, color: "#333", background: "#1a1a1a", borderRadius: 4, padding: "1px 5px", opacity: 0.6, flexShrink: 0, letterSpacing: 0.5 }}>G+{SHORTCUTS[n.key]}</span>
      )}
      {n.badge > 0 && <span style={{ background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "2px 6px", flexShrink: 0, minWidth: 18, textAlign: "center" }}>{n.badge}</span>}
    </button>
  );

  const UserFooter = () => {
    const { dark, toggle } = useTheme();
    const [pushEnabled, setPushEnabled] = useState(Notification.permission === "granted");

    const handlePushToggle = async () => {
      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        addToast("Notifications push non supportées sur ce navigateur.", "warning");
        return;
      }
      if (Notification.permission === "granted") {
        // Déjà activé — informer
        addToast("Notifications push déjà activées.", "info");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjZJgGjtHZKhOFaVTFn1vLqKNQ8A", // clé VAPID publique exemple
          });
          await fetch("/api/push-subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscription: sub, userId: user.id }),
          });
          setPushEnabled(true);
          addToast("🔔 Notifications push activées !", "success");
        } catch (e) {
          addToast("Impossible d'activer les notifications push.", "error");
        }
      } else {
        addToast("Notifications push refusées. Autorisez-les dans les paramètres du navigateur.", "warning");
      }
    };

    return (
    <div style={{ padding: "14px 16px", borderTop: "1px solid #1e1e1e", flexShrink: 0 }}>
      {/* Sélecteur de langue */}
      <div style={{ marginBottom: 10, position: "relative", zIndex: 500 }}>
        <div style={{ fontSize: 10, color: "#555", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          🌐 {lang === "fr" ? "Langue" : lang === "en" ? "Language" : "Idioma"}
        </div>
        <LanguageMenu lang={lang} setLang={setLang} dark={true} dropUp={true} />
      </div>
      {/* Toggle mode sombre */}
      <button onClick={toggle}
        style={{ width: "100%", marginBottom: 8, padding: "8px 12px", borderRadius: 9, border: "1px solid #2a2a2a", background: "rgba(255,255,255,0.05)", color: "#aaa", fontSize: 12, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
        <span>{dark ? "☀️ Mode clair" : "🌙 Mode sombre"}</span>
        <div style={{ width: 32, height: 18, borderRadius: 9, background: dark ? "#fff" : "#333", position: "relative", transition: "background 0.2s" }}>
          <div style={{ position: "absolute", top: 2, left: dark ? 14 : 2, width: 14, height: 14, borderRadius: "50%", background: dark ? "#333" : "#fff", transition: "left 0.2s" }} />
        </div>
      </button>
      {/* Toggle notifications push */}
      <button onClick={handlePushToggle}
        style={{ width: "100%", marginBottom: 10, padding: "8px 12px", borderRadius: 9, border: "1px solid #2a2a2a", background: pushEnabled ? "rgba(46,125,50,0.15)" : "rgba(255,255,255,0.05)", color: pushEnabled ? "#4CAF50" : "#aaa", fontSize: 12, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
        <span>{pushEnabled ? "🔔 Notifications activées" : "🔕 Activer les notifications"}</span>
      </button>
      {/* Profil */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Avatar name={user?.user_metadata?.full_name?.[0] || user?.email?.[0] || "U"} size={30} />
        <div style={{ overflow: "hidden", flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.user_metadata?.full_name || user?.email}</div>
          <div style={{ color: "#F57F17", fontSize: 10, marginTop: 1 }}>✦ Admin</div>
        </div>
      </div>
      <button onClick={onSignOut} style={{ width: "100%", padding: "7px", borderRadius: 8, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontSize: 11, cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit" }}>{t("nav_logout")}</button>
    </div>
  );
  };

  if (isMobile) return (
    <>
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 56, background: "#0F0F0F", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", zIndex: 200, boxShadow: "0 2px 10px rgba(0,0,0,0.3)" }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: "#fff", cursor: "pointer" }} onClick={() => setActive("dashboard")}>SplitLy</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {totalBadge > 0 && <span style={{ background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "2px 7px" }}>{totalBadge}</span>}
          <button onClick={() => setMenuOpen(!menuOpen)} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", padding: 4 }}>☰</button>
        </div>
      </div>
      {menuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300 }}>
          <div onClick={() => setMenuOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 270, background: "#0F0F0F", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #1e1e1e", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: "#fff", cursor: "pointer" }} onClick={() => { setActive("dashboard"); setMenuOpen(false); }}>SplitLy</div>
              <button onClick={() => setMenuOpen(false)} style={{ background: "#1a1a1a", border: "none", color: "#aaa", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "12px 8px" }}>
              {nav.map(n => <NavButton key={n.key} n={n} />)}
            </div>
            <UserFooter />
          </div>
        </div>
      )}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 62, background: "#0F0F0F", display: "flex", alignItems: "center", justifyContent: "space-around", zIndex: 200, borderTop: "1px solid #1e1e1e" }}>
        {nav.slice(0, 5).map(n => (
          <button key={n.key} onClick={() => setActive(n.key)} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", color: active === n.key ? "#fff" : "#555", padding: "6px 4px", position: "relative", flex: 1, textAlign: "center" }}>
            <span style={{ fontSize: 19, display: "block", textAlign: "center" }}>{n.icon}</span>
            <span style={{ fontSize: 9, fontWeight: active === n.key ? 700 : 400, display: "block", textAlign: "center", width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label.split(" ")[0]}</span>
            {n.badge > 0 && <span style={{ position: "absolute", top: 4, right: "50%", transform: "translateX(12px)", background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 9, fontWeight: 700, padding: "0 4px", minWidth: 14, textAlign: "center" }}>{n.badge}</span>}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <aside style={{ width: 260, minWidth: 260, background: "#0F0F0F", display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflow: "hidden" }}>
      {/* Logo */}
      <div style={{ padding: "22px 20px 16px", borderBottom: "1px solid #1e1e1e" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: "#fff", cursor: "pointer", letterSpacing: -0.5 }} onClick={() => setActive("dashboard")}>SplitLy</div>
          <div title="Temps réel actif" style={{ width: 7, height: 7, borderRadius: "50%", background: "#2E7D32", boxShadow: "0 0 6px #2E7D32", flexShrink: 0 }} />
        </div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Gestion de dépenses</div>
      </div>
      {/* Recherche globale */}
      <div style={{ padding: "12px 12px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "8px 12px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontSize: 13, opacity: 0.5 }}>🔍</span>
          <input
            placeholder={lang === "fr" ? "Rechercher..." : lang === "en" ? "Search..." : "Buscar..."}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ background: "none", border: "none", outline: "none", color: "#fff", fontSize: 13, width: "100%", fontFamily: "inherit" }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
          )}
        </div>
      </div>
      {/* Nav */}
      <div style={{ padding: "4px 10px 0", flex: 1, display: "flex", flexDirection: "column", gap: 2, overflow: "auto" }}>
        {nav.map(n => <NavButton key={n.key} n={n} />)}
      </div>
      <UserFooter />
    </aside>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────
function Dashboard({ events, expenses, contributions, user, isMobile, navigateTo, t }) {
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] || "vous";
  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  // ── KPIs globaux ──────────────────────────────────────────
  const grandTotal = expenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const openEvents = events.filter(e => e.status === "open");
  const closedEvents = events.filter(e => e.status === "closed");
  const uniqueParticipants = [...new Set(events.flatMap(e => (e.event_participants || []).map(p => p.name)))];

  // ── Soldes consolidés (tous events ouverts) ───────────────
  let totalToReceive = 0, totalToPay = 0, pendingReimb = 0;
  openEvents.forEach(ev => {
    const evExp = expenses.filter(e => e.event_id === ev.id);
    const evContribs = {};
    (contributions[ev.id] || []).forEach(c => { evContribs[c.participant] = c.amount; });
    const txns = computeTransactions(evExp, evContribs, (ev.event_participants || []).map(p => p.name));
    pendingReimb += txns.length;
  });

  // ── Activité récente (10 dernières charges) ───────────────
  const recentExpenses = [...expenses]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 5);

  // ── Top catégories ────────────────────────────────────────
  const byCategory = Object.keys(CATEGORIES).map(cat => ({
    cat, total: expenses.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0)
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total).slice(0, 5);

  // ── Progression bouclage par event ouvert ─────────────────
  const evProgression = openEvents.map(ev => {
    const evExp = expenses.filter(e => e.event_id === ev.id);
    const participants = (ev.event_participants || []).map(p => p.name);
    const evContribs = {};
    (contributions[ev.id] || []).forEach(c => { evContribs[c.participant] = c.amount; });
    const settled = participants.filter(p => isSettled(computeNetBalance(evExp, evContribs, p))).length;
    const pct = participants.length > 0 ? Math.round((settled / participants.length) * 100) : 0;
    const total = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
    return { ev, participants, settled, pct, total, sym: currencySymbol(ev.currency) };
  });

  const KpiCard = ({ icon, label, value, sub, accent, onClick }) => (
    <div onClick={onClick} style={{ background: "var(--bg-secondary)", borderRadius: 16, padding: "18px 20px", border: `1px solid var(--border)`, borderLeft: `4px solid ${accent}`, cursor: onClick ? "pointer" : "default", transition: "box-shadow 0.15s" }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.9 }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'Playfair Display', serif", color: "var(--text)", letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 4 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      {/* ── En-tête ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 24 : 28, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>
            {t ? t("dash_hello") : "Bonjour"}, {firstName} 👋
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>{dateLabel}</p>
        </div>
        {navigateTo && (
          <button onClick={() => navigateTo("events")} style={{ ...S.btnDark, fontSize: 12, padding: "8px 16px" }}>
            + Nouvel événement
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <EmptyState icon="🎊" title="Aucun événement" subtitle="Créez votre premier événement pour commencer à gérer vos dépenses partagées."
          action={navigateTo && <button onClick={() => navigateTo("events")} style={S.btnDark}>Créer un événement →</button>} />
      ) : (
        <>
          {/* ── KPIs ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
            <KpiCard icon="💰" label="Budget total" value={fmt(grandTotal)} sub={`${expenses.length} charge${expenses.length > 1 ? "s" : ""}`} accent="#0F0F0F" onClick={() => navigateTo && navigateTo("expenses")} />
            <KpiCard icon="🎊" label="Événements" value={events.length} sub={`${openEvents.length} ouvert${openEvents.length > 1 ? "s" : ""} · ${closedEvents.length} bouclé${closedEvents.length > 1 ? "s" : ""}`} accent="#2E7D32" onClick={() => navigateTo && navigateTo("events")} />
            <KpiCard icon="👥" label="Participants" value={uniqueParticipants.length} sub="profils uniques" accent="#1565C0" onClick={() => navigateTo && navigateTo("analytics")} />
            <KpiCard icon="⏳" label="Remboursements" value={pendingReimb} sub="en attente" accent={pendingReimb > 0 ? "#F57F17" : "#2E7D32"} onClick={() => navigateTo && navigateTo("balance")} />
          </div>

          {/* ── Progression bouclage ── */}
          {evProgression.length > 0 && (
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>📈 Progression vers bouclage</div>
                <button onClick={() => navigateTo && navigateTo("balance")} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>Voir soldes →</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {evProgression.map(({ ev, participants, settled, pct, total, sym }) => (
                  <div key={ev.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 14 }}>🎊</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</span>
                        <span style={{ fontSize: 10, color: "var(--text-sub)", flexShrink: 0 }}>{ev.date}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: "var(--text-sub)" }}>{settled}/{participants.length} soldés</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{fmt(total, sym)}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? "#2E7D32" : "#F57F17" }}>{pct}%</span>
                      </div>
                    </div>
                    <div style={{ background: "var(--border)", borderRadius: 6, height: 6, overflow: "hidden" }}>
                      <div style={{ background: pct === 100 ? "#2E7D32" : "#F57F17", borderRadius: 6, height: 6, width: `${pct}%`, transition: "width 0.6s ease" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Grille basse : top catégories + activité récente ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>

            {/* Top catégories */}
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, padding: 20, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🏷️ Top catégories</div>
                <button onClick={() => navigateTo && navigateTo("analytics")} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>Analyses →</button>
              </div>
              {byCategory.length === 0 ? (
                <div style={{ color: "var(--text-sub)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Aucune charge enregistrée</div>
              ) : byCategory.map(c => (
                <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 18, flexShrink: 0, width: 26 }}>{CATEGORIES[c.cat].icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.cat}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", flexShrink: 0, marginLeft: 8 }}>
                        {grandTotal > 0 ? ((c.total / grandTotal) * 100).toFixed(0) : 0}%
                      </span>
                    </div>
                    <div style={{ background: "var(--border)", borderRadius: 6, height: 5, overflow: "hidden" }}>
                      <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 6, height: 5, width: `${grandTotal > 0 ? (c.total / grandTotal) * 100 : 0}%`, transition: "width 0.5s" }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", flexShrink: 0, minWidth: 48, textAlign: "right" }}>{fmt(c.total)}</span>
                </div>
              ))}
            </div>

            {/* Activité récente */}
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, padding: 20, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🕐 Activité récente</div>
                <button onClick={() => navigateTo && navigateTo("expenses")} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>Toutes →</button>
              </div>
              {recentExpenses.length === 0 ? (
                <div style={{ color: "var(--text-sub)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Aucune charge récente</div>
              ) : recentExpenses.map((ex, i) => {
                const ev = events.find(e => e.id === ex.event_id);
                const cat = CATEGORIES[ex.category];
                const total = ex.qty * (ex.unit_price ?? 0);
                const sym = currencySymbol(ev?.currency);
                return (
                  <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, marginBottom: 12, borderBottom: i < recentExpenses.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: cat?.color || "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{cat?.icon || "🧾"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail || "—"}</div>
                      <div style={{ fontSize: 10, color: "var(--text-sub)", marginTop: 2 }}>{ev?.name} · {ex.is_unpaid ? "⏳ Non réglée" : `par ${ex.paid_by}`}</div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{fmt(total, sym)}</div>
                  </div>
                );
              })}
            </div>

          </div>
        </>
      )}
    </div>
  );
}

// ─── ÉVÉNEMENTS ───────────────────────────────────────────────
const TEMPLATES_KEY = "splitly_templates";

function getTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]"); } catch { return []; }
}
function saveTemplates(templates) {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates)); } catch {}
}

function Events({ events, expenses, contributions, user, reload, isMobile, addToast, t }) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", date: "", currency: "EUR €", participants: [] });
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [managingEv, setManagingEv] = useState(null);
  const [newParticipant, setNewParticipant] = useState("");
  const [templates, setTemplates] = useState(getTemplates());
  const [showTemplates, setShowTemplates] = useState(false);
  const [sortEvents, setSortEvents] = useState("date_desc");

  const MAX_PARTICIPANTS = 30;
  const MAX_NAME_LENGTH = 50;
  const MAX_PARTICIPANT_NAME = 30;

  // Sauvegarder un événement comme modèle
  const handleSaveTemplate = (ev) => {
    const participants = (ev.event_participants || []).map(p => p.name);
    const template = {
      id: Date.now().toString(),
      name: ev.name,
      currency: ev.currency,
      participants,
      savedAt: new Date().toISOString(),
    };
    const updated = [template, ...templates.filter(t => t.name !== ev.name)].slice(0, 10);
    saveTemplates(updated);
    setTemplates(updated);
    addToast(`Modèle "${ev.name}" sauvegardé !`, "success");
  };

  // Créer un événement depuis un modèle
  const handleUseTemplate = (template) => {
    setForm({
      name: template.name,
      date: new Date().toISOString().split("T")[0],
      currency: template.currency,
      participants: [...template.participants],
    });
    setShowTemplates(false);
    setShowNew(true);
  };

  // Supprimer un modèle
  const handleDeleteTemplate = (id) => {
    const updated = templates.filter(t => t.id !== id);
    saveTemplates(updated);
    setTemplates(updated);
  };

  const handleCreate = async () => {
    // Validations
    if (!form.name.trim()) { addToast("Le nom de l'événement est obligatoire.", "warning"); return; }
    if (form.name.trim().length > MAX_NAME_LENGTH) { addToast(`Le nom ne peut pas dépasser ${MAX_NAME_LENGTH} caractères.`, "warning"); return; }
    if (!form.date) { addToast("La date est obligatoire.", "warning"); return; }
    if (form.participants.length < 2) { addToast("Minimum 2 participants requis.", "warning"); return; }
    if (form.participants.length > MAX_PARTICIPANTS) { addToast(`Maximum ${MAX_PARTICIPANTS} participants par événement.`, "warning"); return; }
    setLoading(true);
    const { error } = await createEvent(form, form.participants, user.id);
    if (!error) {
      await reload();
      setForm({ name: "", date: "", currency: "EUR €", participants: [] });
      setShowNew(false);
      addToast("Événement créé avec succès !", "success");
    } else {
      addToast("Erreur lors de la création : " + error.message, "error");
    }
    setLoading(false);
  };

  const handleDelete = (ev) => {
    setConfirm({
      message: `Supprimer définitivement "${ev.name}" et toutes ses charges ?`,
      warnings: ["Cette action est irréversible."],
      onConfirm: async () => {
        await deleteEvent(ev.id);
        await reload();
        setConfirm(null);
        addToast(`"${ev.name}" supprimé.`, "info");
      },
      onCancel: () => setConfirm(null),
    });
  };

  const handleClose = async (ev) => {
    const evExp = expenses.filter(e => e.event_id === ev.id);
    const participants = (ev.event_participants || []).map(p => p.name);
    const evContribMap = {};
    (contributions[ev.id] || []).forEach(c => { evContribMap[c.participant] = c.amount; });
    const allSettled = participants.every(p => isSettled(computeNetBalance(evExp, evContribMap, p)));
    if (!allSettled) { addToast("Tous les participants doivent solder avant de boucler.", "warning"); return; }
    setConfirm({
      message: `Boucler "${ev.name}" ? L'historique sera effacé et aucune modification ne sera plus possible.`,
      warnings: ["Action irréversible.", "Un résumé PDF sera envoyé par email à l'admin."],
      onConfirm: async () => {
        await updateEventStatus(ev.id, "closed");
        await reload();
        setConfirm(null);
        addToast(`"${ev.name}" bouclé avec succès.`, "success");

        // Envoyer le résumé PDF par email à l'admin
        try {
          const sym = currencySymbol(ev.currency);
          const fmt2 = (n) => `${Number(n).toFixed(2)} ${sym}`;
          const budget = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);

          // Construire le résumé texte
          const expenseRows = evExp.map(ex => {
            const t = ex.qty * (ex.unit_price ?? 0);
            return `<tr style="border-bottom:1px solid #f0f0f0">
              <td style="padding:8px 12px">${CATEGORIES[ex.category]?.icon || ""} ${ex.sub_category || ""}</td>
              <td style="padding:8px 12px">${ex.detail}</td>
              <td style="padding:8px 12px;text-align:right;font-weight:700">${fmt2(t)}</td>
              <td style="padding:8px 12px">${ex.is_unpaid ? "⏳ Non réglée" : ex.paid_by}</td>
            </tr>`;
          }).join("");

          const contribRows = participants.map(p => {
            const owed = computeOwed(evExp, p);
            const paid = evContribMap[p] || 0;
            const net = paid - owed;
            const settled = Math.abs(net) <= 1;
            return `<tr style="border-bottom:1px solid #f0f0f0">
              <td style="padding:8px 12px;font-weight:600">${p}</td>
              <td style="padding:8px 12px;text-align:right">${fmt2(owed)}</td>
              <td style="padding:8px 12px;text-align:right">${fmt2(paid)}</td>
              <td style="padding:8px 12px;font-weight:700;color:${settled ? "#2E7D32" : net < 0 ? "#C62828" : "#1565C0"}">
                ${settled ? "✓ Soldé" : net < 0 ? `Doit ${fmt2(Math.abs(net))}` : `Reçoit ${fmt2(net)}`}
              </td>
            </tr>`;
          }).join("");

          const html = `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:0">
              <div style="background:linear-gradient(135deg,#0F0F0F,#1a1a2e);padding:32px;color:#fff;border-radius:12px 12px 0 0">
                <div style="font-size:24px;font-weight:700;margin-bottom:4px">SplitLy</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.6)">Résumé de clôture d'événement</div>
              </div>
              <div style="background:#fff;padding:28px;border:1px solid #eee;border-top:none">
                <h2 style="font-size:20px;margin-bottom:4px">🔒 ${ev.name}</h2>
                <div style="font-size:13px;color:#888;margin-bottom:24px">
                  Bouclé le ${new Date().toLocaleDateString("fr-FR")} · ${participants.length} participants · Budget total : <strong>${fmt2(budget)}</strong>
                </div>

                <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:12px">Charges</h3>
                <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
                  <thead>
                    <tr style="background:#f5f5f5">
                      <th style="padding:8px 12px;text-align:left">Catégorie</th>
                      <th style="padding:8px 12px;text-align:left">Description</th>
                      <th style="padding:8px 12px;text-align:right">Montant</th>
                      <th style="padding:8px 12px;text-align:left">Payé par</th>
                    </tr>
                  </thead>
                  <tbody>${expenseRows}</tbody>
                </table>

                <h3 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:12px">Soldes finaux</h3>
                <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px">
                  <thead>
                    <tr style="background:#f5f5f5">
                      <th style="padding:8px 12px;text-align:left">Participant</th>
                      <th style="padding:8px 12px;text-align:right">Part due</th>
                      <th style="padding:8px 12px;text-align:right">Versé</th>
                      <th style="padding:8px 12px;text-align:left">Statut</th>
                    </tr>
                  </thead>
                  <tbody>${contribRows}</tbody>
                </table>

                <a href="https://splitmeapp.com" style="display:inline-block;background:#0F0F0F;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:13px">
                  Ouvrir SplitLy →
                </a>
              </div>
              <div style="background:#f9f9f9;padding:16px;border-radius:0 0 12px 12px;font-size:11px;color:#aaa;text-align:center">
                SplitLy · splitmeapp.com · Résumé généré le ${new Date().toLocaleString("fr-FR")}
              </div>
            </div>
          `;

          await fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: user.email,
              subject: `🔒 SplitLy — Résumé de clôture : ${ev.name}`,
              html,
            }),
          });
          addToast("Résumé envoyé par email !", "info");
        } catch (e) {
          console.error("Erreur envoi résumé clôture:", e);
        }
      },
      onCancel: () => setConfirm(null),
    });
  };

  const handleAddParticipant = async (ev) => {
    const name = newParticipant.trim();
    if (!name) { addToast("Le prénom ne peut pas être vide.", "warning"); return; }
    if (name.length > MAX_PARTICIPANT_NAME) { addToast(`Le prénom ne peut pas dépasser ${MAX_PARTICIPANT_NAME} caractères.`, "warning"); return; }
    const currentCount = (ev.event_participants || []).length;
    if (currentCount >= MAX_PARTICIPANTS) { addToast(`Maximum ${MAX_PARTICIPANTS} participants par événement.`, "warning"); return; }
    const existing = (ev.event_participants || []).map(p => p.name.toLowerCase());
    if (existing.includes(name.toLowerCase())) { addToast("Ce participant existe déjà.", "warning"); return; }
    await addParticipant(ev.id, name);
    await reload();
    setNewParticipant("");
    addToast(`${name} ajouté à l'événement.`, "success");
    setManagingEv(events.find(e => e.id === ev.id) || ev);
  };

  const handleRemoveParticipant = (ev, name) => {
    setConfirm({
      message: `Retirer "${name}" de "${ev.name}" ? Les calculs seront recalculés.`,
      onConfirm: async () => {
        await removeParticipant(ev.id, name);
        await reload();
        setConfirm(null);
        addToast(`${name} retiré de l'événement.`, "info");
      },
      onCancel: () => setConfirm(null),
    });
  };

  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}
      {managingEv && (
        <Modal title={`Participants — ${managingEv.name}`} onClose={() => { setManagingEv(null); setNewParticipant(""); }}>
          <div style={{ marginBottom: 16 }}>
            {(managingEv.event_participants || []).length === 0 && <div style={{ color: "#bbb", fontSize: 13, padding: "12px 0" }}>Aucun participant</div>}
            {(managingEv.event_participants || []).map((p, i) => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f5f5f5" }}>
                <Avatar name={p.name} size={30} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{p.name}</span>
                {managingEv.status === "open" && (
                  <button onClick={() => { setManagingEv(null); handleRemoveParticipant(managingEv, p.name); }}
                    style={{ padding: "4px 12px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                    Retirer
                  </button>
                )}
              </div>
            ))}
          </div>
          {managingEv.status === "open" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <label style={S.label}>Ajouter un participant</label>
                <span style={{ fontSize: 11, color: (managingEv.event_participants || []).length >= 30 ? "#C62828" : "#aaa", fontWeight: 600 }}>
                  {(managingEv.event_participants || []).length}/30 participants
                </span>
              </div>
              {(managingEv.event_participants || []).length >= 30 ? (
                <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#C62828" }}>
                  ⚠️ Maximum 30 participants atteint.
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...S.input, flex: 1 }} placeholder="Prénom (max 30 caractères)" value={newParticipant}
                    onChange={e => setNewParticipant(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleAddParticipant(managingEv)}
                    maxLength={30} />
                  <button onClick={() => handleAddParticipant(managingEv)} style={{ ...S.btnDark, padding: "9px 16px" }}>+</button>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>Événements</h2>
          <p style={{ color: "#888", fontSize: 12 }}>{events.length} événement{events.length > 1 ? "s" : ""}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {templates.length > 0 && (
            <button onClick={() => setShowTemplates(!showTemplates)}
              style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }}>
              📋 Modèles ({templates.length})
            </button>
          )}
          <button onClick={() => { setShowNew(!showNew); setShowTemplates(false); }} style={S.btnDark}>
            {showNew ? "× Fermer" : "+ Nouveau"}
          </button>
        </div>
      </div>

      {/* Panel modèles */}
      {showTemplates && templates.length > 0 && (
        <div style={{ ...S.card, marginBottom: 16, border: "1.5px solid #e0e0e0" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>📋 Modèles sauvegardés</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {templates.map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fafafa", borderRadius: 10, border: "1px solid #eee" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                    {t.participants.length} participants · {currencySymbol(t.currency)} · Sauvegardé le {new Date(t.savedAt).toLocaleDateString("fr-FR")}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {t.participants.slice(0, 5).map(p => (
                      <span key={p} style={{ fontSize: 10, background: "#f0f0f0", padding: "2px 8px", borderRadius: 20, color: "#666" }}>{p}</span>
                    ))}
                    {t.participants.length > 5 && <span style={{ fontSize: 10, color: "#aaa" }}>+{t.participants.length - 5}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => handleUseTemplate(t)}
                    style={{ ...S.btnDark, padding: "6px 14px", fontSize: 12 }}>
                    Utiliser →
                  </button>
                  <button onClick={() => handleDeleteTemplate(t.id)}
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", cursor: "pointer", fontSize: 12 }}>
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showNew && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={S.sectionTitle}>Créer un événement</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div><label style={S.label}>Nom de l'événement</label><input style={S.input} placeholder="Ex: Soirée chez Marc" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={50} /></div>
            <div><label style={S.label}>Date</label><input type="date" style={S.input} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
              <label style={S.label}>Monnaie</label>
              <select style={{ ...S.input, maxWidth: 220 }} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 18 }}>
            <ParticipantInput participants={form.participants} onChange={p => setForm({ ...form, participants: p })} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleCreate} disabled={loading || form.participants.length < 2}
              style={{ ...S.btnDark, opacity: form.participants.length < 2 ? 0.5 : 1 }}>
              {loading ? "Création..." : "Créer l'événement"}
            </button>
            <button onClick={() => setShowNew(false)} style={S.btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      {events.length === 0 && !showNew ? (
        <EmptyState icon="🎊" title="Aucun événement" subtitle="Créez votre premier événement pour commencer."
          action={<button onClick={() => setShowNew(true)} style={S.btnDark}>+ Créer un événement</button>} />
      ) : (
        <>
          {/* Tri */}
          {events.length > 1 && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <select style={{ ...S.input, width: "auto", fontSize: 12 }} value={sortEvents} onChange={e => setSortEvents(e.target.value)}>
                <option value="date_desc">📅 Plus récent</option>
                <option value="date_asc">📅 Plus ancien</option>
                <option value="name_asc">🔤 Nom A→Z</option>
                <option value="amount_desc">💰 Budget ↓</option>
                <option value="status">🔒 Statut</option>
              </select>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[...events].sort((a, b) => {
            if (sortEvents === "date_asc") return new Date(a.date) - new Date(b.date);
            if (sortEvents === "name_asc") return a.name.localeCompare(b.name);
            if (sortEvents === "amount_desc") {
              const ta = expenses.filter(e => e.event_id === a.id).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
              const tb = expenses.filter(e => e.event_id === b.id).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
              return tb - ta;
            }
            if (sortEvents === "status") return a.status === "closed" ? 1 : -1;
            return new Date(b.date) - new Date(a.date); // date_desc
          }).map(ev => {
            const participants = (ev.event_participants || []).map(p => p.name);
            const evExp = expenses.filter(e => e.event_id === ev.id);
            const evContribMap = {};
            (contributions[ev.id] || []).forEach(c => { evContribMap[c.participant] = c.amount; });
            const evTotal = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
            const settledCount = participants.filter(p => isSettled(computeNetBalance(evExp, evContribMap, p))).length;
            const allSettled = participants.length > 0 && settledCount === participants.length;
            const progress = participants.length > 0 ? (settledCount / participants.length) * 100 : 0;

            return (
              <div key={ev.id} style={{ background: "#fff", borderRadius: 16, padding: isMobile ? "16px" : "18px 22px", border: "1px solid #eee", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: ev.status === "closed" ? "#f5f5f5" : allSettled ? "#E8F5E9" : "#f0faf4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                    {ev.status === "closed" ? "🔒" : "🎊"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: isMobile ? 140 : 260 }}>{ev.name}</span>
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: ev.status === "closed" ? "#f0f0f0" : allSettled ? "#E8F5E9" : "#fff8e1", color: ev.status === "closed" ? "#999" : allSettled ? "#2E7D32" : "#F57F17", fontWeight: 700, flexShrink: 0 }}>
                        {ev.status === "closed" ? "🔒 Bouclé" : allSettled ? "✓ Prêt à boucler" : "En cours"}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#999", marginBottom: 10 }}>📅 {ev.date} · {currencySymbol(ev.currency)} · {evExp.length} charge{evExp.length > 1 ? "s" : ""}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: ev.status === "open" ? 12 : 0 }}>
                      <AvatarStack names={participants} size={24} />
                      <button onClick={() => setManagingEv(ev)}
                        style={{ fontSize: 11, color: "#1565C0", background: "#E3F2FD", border: "none", borderRadius: 8, padding: "3px 10px", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                        👥 Gérer
                      </button>
                    </div>
                    {ev.status === "open" && (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "#aaa" }}>Progression vers bouclage</span>
                          <span style={{ fontSize: 11, color: allSettled ? "#2E7D32" : "#F57F17", fontWeight: 700 }}>{settledCount}/{participants.length} soldés</span>
                        </div>
                        <div style={{ background: "#f0f0f0", borderRadius: 6, height: 6, overflow: "hidden" }}>
                          <div style={{ background: allSettled ? "#2E7D32" : "#F57F17", borderRadius: 6, height: 6, width: `${progress}%`, transition: "width 0.4s ease" }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "'Playfair Display', serif", marginBottom: 2 }}>{fmt(evTotal, currencySymbol(ev.currency))}</div>
                    <div style={{ fontSize: 10, color: "#aaa", marginBottom: 10 }}>budget collectif</div>
                    {ev.status === "open" && (
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button onClick={() => handleSaveTemplate(ev)}
                          title="Sauvegarder comme modèle"
                          style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #e0e0e0", background: "#fafafa", color: "#555", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                          📋 Modèle
                        </button>
                        {allSettled && (
                          <button onClick={() => handleClose(ev)} style={{ ...S.btnDark, padding: "5px 12px", fontSize: 11, background: "#2E7D32", borderRadius: 8 }}>
                            🔒 Boucler
                          </button>
                        )}
                        <button onClick={() => handleDelete(ev)} style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                          Supprimer
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── CHARGES ──────────────────────────────────────────────────
function Expenses({ events, expenses, contributions, user, reload, isMobile, addToast, t }) {
  const [showForm, setShowForm] = useState(false);
  const [filterEvent, setFilterEvent] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [sortBy, setSortBy] = useState("date_desc");
  const [searchText, setSearchText] = useState("");
  const [editingEx, setEditingEx] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [unpaid, setUnpaid] = useState(false);
  const empty = { eventId: "", category: "", sub: "", detail: "", qty: 1, unit: "", paidBy: "", included: [], comment: "" };
  const [form, setForm] = useState(empty);

  const handleEventChange = (evId) => {
    const ev = events.find(e => e.id === evId);
    const participants = (ev?.event_participants || []).map(p => p.name);
    setForm(f => ({ ...f, eventId: evId, paidBy: "", included: [...participants] }));
  };

  const currentEvent = events.find(e => e.id === form.eventId);
  const participants = (currentEvent?.event_participants || []).map(p => p.name);
  const total = (Number(form.qty) || 0) * (Number(form.unit) || 0);
  const sharePerPerson = form.included.length > 0 ? total / form.included.length : 0;

  const handleSave = async () => {
    if (!form.eventId || !form.category || !form.sub || !form.detail || form.included.length === 0) {
      addToast(t("toast_fill_all"), "warning"); return;
    }
    if (!unpaid && !form.paidBy) {
      addToast("Sélectionnez un payeur ou cochez 'Charge non réglée'.", "warning"); return;
    }
    const amountError = validateAmount(form.qty, form.unit);
    if (amountError) { addToast(amountError, "warning"); return; }
    setSaving(true);
    const qty = Number(form.qty);
    const unit = Number(form.unit);
    const totalAmount = qty * unit;

    if (editingEx) {
      // Modification : ajuster la contribution du payeur seulement si la charge était réglée
      const oldTotal = editingEx.qty * (editingEx.unit_price ?? 0);
      const oldPayer = editingEx.paid_by;
      const newPayer = form.paidBy;
      const wasUnpaid = editingEx.is_unpaid || false;

      if (!wasUnpaid && !unpaid) {
        // Les deux versions sont réglées — ajuster le delta
        const evContribs = contributions[form.eventId] || [];
        const getContrib = (name) => (evContribs.find(c => c.participant === name)?.amount || 0);
        if (oldPayer === newPayer) {
          const current = getContrib(newPayer);
          await upsertContribution(form.eventId, newPayer, Math.max(0, current - oldTotal + totalAmount), user.id);
        } else {
          const oldCurrent = getContrib(oldPayer);
          await upsertContribution(form.eventId, oldPayer, Math.max(0, oldCurrent - oldTotal), user.id);
          const newCurrent = getContrib(newPayer);
          await upsertContribution(form.eventId, newPayer, newCurrent + totalAmount, user.id);
        }
      } else if (wasUnpaid && !unpaid) {
        // Charge qui était non réglée, maintenant réglée → créditer le payeur
        const evContribs = contributions[form.eventId] || [];
        const currentContrib = evContribs.find(c => c.participant === newPayer)?.amount || 0;
        await upsertContribution(form.eventId, newPayer, currentContrib + totalAmount, user.id);
      } else if (!wasUnpaid && unpaid) {
        // Charge qui était réglée, maintenant non réglée → décréditer l'ancien payeur
        const evContribs = contributions[form.eventId] || [];
        const currentContrib = evContribs.find(c => c.participant === oldPayer)?.amount || 0;
        await upsertContribution(form.eventId, oldPayer, Math.max(0, currentContrib - oldTotal), user.id);
      }
      // Si wasUnpaid && unpaid → rien à faire

      await updateExpense(editingEx.id, { ...form, qty, unit, is_unpaid: unpaid }, user.id, editingEx);
      addToast(t("toast_expense_edited"), "success");
    } else {
      // Nouvelle charge
      await createExpense({ ...form, qty, unit, is_unpaid: unpaid }, user.id);

      // Créditer le payeur seulement si la charge est réglée
      if (!unpaid) {
        const evContribs = contributions[form.eventId] || [];
        const currentContrib = evContribs.find(c => c.participant === form.paidBy)?.amount || 0;
        await upsertContribution(form.eventId, form.paidBy, currentContrib + totalAmount, user.id);
      }

      addToast(t("toast_expense_added"), "success");
    }
    await reload(); setForm(empty); setEditingEx(null); setShowForm(false); setUnpaid(false); setSaving(false);
  };

  const startEdit = (ex) => {
    setForm({ eventId: ex.event_id, category: ex.category, sub: ex.sub_category || "", detail: ex.detail, qty: ex.qty, unit: ex.unit_price ?? 0, paidBy: ex.paid_by || "", included: [...(ex.included || [])], comment: ex.comment || "" });
    setUnpaid(ex.is_unpaid || false);
    setEditingEx(ex); setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (ex) => {
    setConfirm({
      message: `Supprimer la charge "${ex.detail}" ?`,
      onConfirm: async () => {
        // Décrémenter la contribution du payeur seulement si la charge était réglée
        if (!ex.is_unpaid && ex.paid_by) {
          const evContribs = contributions[ex.event_id] || [];
          const currentContrib = evContribs.find(c => c.participant === ex.paid_by)?.amount || 0;
          const totalAmount = ex.qty * (ex.unit_price ?? 0);
          await upsertContribution(ex.event_id, ex.paid_by, Math.max(0, currentContrib - totalAmount), user.id);
        }
        await deleteExpense(ex, user.id);
        await reload();
        setConfirm(null);
        addToast(t("toast_expense_deleted"), "info");
      },
      onCancel: () => setConfirm(null),
    });
  };

  // Filtrage et tri
  let filtered = filterEvent === "all" ? expenses : expenses.filter(e => e.event_id === filterEvent);
  if (filterCategory !== "all") filtered = filtered.filter(e => e.category === filterCategory);
  if (searchText.trim()) {
    const q = searchText.toLowerCase();
    filtered = filtered.filter(e =>
      e.detail?.toLowerCase().includes(q) ||
      e.paid_by?.toLowerCase().includes(q) ||
      e.sub_category?.toLowerCase().includes(q) ||
      e.comment?.toLowerCase().includes(q)
    );
  }
  filtered = [...filtered].sort((a, b) => {
    const ta = a.qty * (a.unit_price ?? 0);
    const tb = b.qty * (b.unit_price ?? 0);
    if (sortBy === "amount_desc") return tb - ta;
    if (sortBy === "amount_asc") return ta - tb;
    if (sortBy === "date_asc") return new Date(a.created_at) - new Date(b.created_at);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>Charges</h2>
          <p style={{ color: "#888", fontSize: 12 }}>{expenses.length} dépense{expenses.length > 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => { setForm(empty); setEditingEx(null); setShowForm(!showForm); }}
          style={S.btnDark}>{showForm && !editingEx ? "× Fermer" : "+ Ajouter"}</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {/* Recherche texte */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--input-bg)", borderRadius: 10, padding: "8px 12px", border: "1.5px solid var(--border)", flex: isMobile ? "1 1 100%" : "1 1 180px", minWidth: 140 }}>
          <span style={{ opacity: 0.5, fontSize: 13 }}>🔍</span>
          <input
            placeholder="Rechercher une charge..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, width: "100%", fontFamily: "inherit" }}
          />
          {searchText && <button onClick={() => setSearchText("")} style={{ background: "none", border: "none", color: "var(--text-sub)", cursor: "pointer", fontSize: 15, padding: 0 }}>×</button>}
        </div>
        <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          <option value="all">Tous les événements ({expenses.length})</option>
          {events.map(ev => {
            const count = expenses.filter(e => e.event_id === ev.id).length;
            return <option key={ev.id} value={ev.id}>{ev.name} ({count})</option>;
          })}
        </select>
        <select style={{ ...S.input, width: "auto" }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="all">Toutes catégories</option>
          {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{CATEGORIES[c].icon} {c}</option>)}
        </select>
        <select style={{ ...S.input, width: "auto" }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="date_desc">📅 Plus récent</option>
          <option value="date_asc">📅 Plus ancien</option>
          <option value="amount_desc">💰 Montant ↓</option>
          <option value="amount_asc">💰 Montant ↑</option>
        </select>
        {(filterEvent !== "all" || filterCategory !== "all" || searchText) && (
          <button onClick={() => { setFilterEvent("all"); setFilterCategory("all"); setSearchText(""); }} style={{ ...S.btnGhost, padding: "8px 12px", fontSize: 12 }}>
            × Réinitialiser
          </button>
        )}
        {filtered.length !== expenses.length && (
          <span style={{ fontSize: 12, color: "var(--text-sub)" }}>{filtered.length} résultat{filtered.length > 1 ? "s" : ""}</span>
        )}
      </div>

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16, border: editingEx ? "1.5px solid #F57F17" : "1px solid #eee" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={S.sectionTitle}>{editingEx ? "✏️ Modifier la charge" : "➕ Nouvelle charge"}</div>
            {editingEx && <span style={{ fontSize: 11, color: "#F57F17", fontWeight: 600 }}>Mode édition</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={S.label}>Événement</label>
              <select style={S.input} value={form.eventId} onChange={e => handleEventChange(e.target.value)} disabled={!!editingEx}>
                <option value="">Sélectionner...</option>
                {events.filter(e => e.status === "open").map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Payé par</label>
              <select style={{ ...S.input, opacity: unpaid ? 0.5 : 1 }} value={form.paidBy} onChange={e => setForm({ ...form, paidBy: e.target.value })} disabled={!currentEvent || unpaid}>
                <option value="">Sélectionner...</option>
                {participants.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* Toggle charge non réglée */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "12px 16px", borderRadius: 12, background: unpaid ? "#FFF8E1" : "#fafafa", border: `1.5px solid ${unpaid ? "#F57F17" : "#eee"}`, transition: "all 0.2s" }}>
              <div style={{ position: "relative", width: 40, height: 22, flexShrink: 0 }} onClick={() => { setUnpaid(!unpaid); if (!unpaid) setForm(f => ({ ...f, paidBy: "" })); }}>
                <div style={{ position: "absolute", inset: 0, background: unpaid ? "#F57F17" : "#ddd", borderRadius: 11, transition: "background 0.2s" }} />
                <div style={{ position: "absolute", top: 3, left: unpaid ? 21 : 3, width: 16, height: 16, background: "#fff", borderRadius: "50%", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: unpaid ? "#E65100" : "#333" }}>
                  ⏳ Charge non encore réglée
                </div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                  {unpaid ? "Aucune contribution ne sera créditée. À mettre à jour quand quelqu'un paie." : "Décochez si personne n'a encore payé cette charge."}
                </div>
              </div>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={S.label}>Catégorie</label>
              <select style={S.input} value={form.category} onChange={e => setForm({ ...form, category: e.target.value, sub: "" })}>
                <option value="">Sélectionner...</option>
                {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{CATEGORIES[c].icon} {c}</option>)}
              </select>
            </div>
            <div><label style={S.label}>Sous-catégorie</label>
              <select style={S.input} value={form.sub} onChange={e => setForm({ ...form, sub: e.target.value })} disabled={!form.category}>
                <option value="">Sélectionner...</option>
                {form.category && CATEGORIES[form.category].subs.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}><label style={S.label}>Détail / Nature</label>
            <input style={S.input} placeholder="Ex: Vin rouge Côtes du Rhône, Salade César..." value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div><label style={S.label}>Quantité</label><input type="number" min="1" max="10000" step="1" style={S.input} value={form.qty} onChange={e => setForm({ ...form, qty: Math.floor(Math.abs(Number(e.target.value))) || 1 })} /></div>
            <div><label style={S.label}>Prix unitaire</label><input type="number" min="0" step="0.01" style={S.input} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
            <div><label style={S.label}>Total auto</label>
              <div style={{ ...S.input, background: total > 0 ? "#f0faf4" : "#f8f8f8", color: total > 0 ? "#2E7D32" : "#aaa", fontWeight: 700, display: "flex", alignItems: "center" }}>
                {total.toFixed(2)} {currencySymbol(currentEvent?.currency)}
              </div>
            </div>
          </div>
          {currentEvent && (
            <div style={{ marginBottom: 16, padding: 16, background: "#fafafa", borderRadius: 12, border: "1px solid #f0f0f0" }}>
              <ParticipantToggle people={participants} selected={form.included} onChange={p => setForm({ ...form, included: p })} label="Qui partage cette charge ?" />
              {form.included.length > 0 && total > 0 && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "#E8F5E9", borderRadius: 10, fontSize: 13, color: "#2E7D32", fontWeight: 600 }}>
                  ➗ {sharePerPerson.toFixed(2)} {currencySymbol(currentEvent?.currency)} / personne · {form.included.length} inclus
                </div>
              )}
              {form.included.length === 0 && <div style={{ marginTop: 8, fontSize: 12, color: "#C62828" }}>⚠️ Sélectionnez au moins une personne</div>}
            </div>
          )}
          {/* Commentaire optionnel */}
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>💬 Commentaire (optionnel)</label>
            <textarea
              style={{ ...S.input, resize: "vertical", minHeight: 64, fontFamily: "inherit", lineHeight: 1.5 }}
              placeholder="Ex: Remboursement pour le billet d'Alice achetée en avance..."
              value={form.comment || ""}
              onChange={e => setForm({ ...form, comment: e.target.value })}
              maxLength={300}
            />
            {form.comment && <div style={{ fontSize: 10, color: "#aaa", marginTop: 3, textAlign: "right" }}>{form.comment.length}/300</div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={S.btnDark}>{saving ? "Enregistrement..." : editingEx ? "Enregistrer les modifications" : "Ajouter la charge"}</button>
            <button onClick={() => { setShowForm(false); setEditingEx(null); setForm(empty); }} style={S.btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon="🧾" title="Aucune charge" subtitle={filterEvent === "all" ? "Aucune dépense enregistrée." : "Aucune dépense pour cet événement."}
          action={<button onClick={() => setShowForm(true)} style={S.btnDark}>+ Ajouter une charge</button>} />
      ) : isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(ex => {
            const cat = CATEGORIES[ex.category];
            const ev = events.find(e => e.id === ex.event_id);
            const evSym = currencySymbol(ev?.currency);
            const t = ex.qty * (ex.unit_price ?? 0);
            const inc = ex.included || [];
            const share = inc.length > 0 ? t / inc.length : 0;
            return (
              <div key={ex.id} style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", border: "1px solid #eee" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{cat?.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail}</div>
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ev?.name} · {ex.is_unpaid ? <span style={{ color: "#F57F17", fontWeight: 600 }}>⏳ Non réglée</span> : `par ${ex.paid_by}`}
                      </div>
                      {ex.comment && <div style={{ fontSize: 11, color: "#888", marginTop: 3, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {ex.comment}</div>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(t, evSym)}</div>
                    <div style={{ fontSize: 11, color: "#2E7D32", fontWeight: 600 }}>{fmt(share, evSym)}/p.</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {cat && <Badge label={ex.sub_category} color={cat.color} accent={cat.accent} />}
                    {ex.is_unpaid && <Badge label="⏳ Non réglée" color="#FFF8E1" accent="#F57F17" />}
                    <AvatarStack names={inc} size={18} />
                  </div>
                  {ev?.status === "open" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => startEdit(ex)} style={{ padding: "4px 10px", borderRadius: 8, border: "1.5px solid #e0e0e0", background: "#fff", fontSize: 12, cursor: "pointer" }}>✏️</button>
                      <button onClick={() => handleDelete(ex)} style={{ padding: "4px 10px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", fontSize: 12, cursor: "pointer" }}>🗑️</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ overflowX: "auto", width: "100%" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr style={{ background: "#f8f8f8", borderBottom: "1.5px solid #eee" }}>
                {["Catégorie", "Détail", "Événement", "Qté", "Unitaire", "Total", "Part/p.", "Payé par", "Inclus", ""].map(h => (
                  <th key={h} style={{ padding: "12px 12px", fontSize: 10, fontWeight: 700, color: "#999", textAlign: "left", textTransform: "uppercase", letterSpacing: 0.7, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ex, i) => {
                const cat = CATEGORIES[ex.category];
                const ev = events.find(e => e.id === ex.event_id);
                const evSym = currencySymbol(ev?.currency);
                const t = ex.qty * (ex.unit_price ?? 0);
                const inc = ex.included || [];
                const share = inc.length > 0 ? t / inc.length : 0;
                return (
                  <tr key={ex.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f5f5f5" : "none", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#fafafa"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "11px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ fontSize: 16 }}>{cat?.icon}</span>
                        {cat && <Badge label={ex.sub_category} color={cat.color} accent={cat.accent} />}
                      </div>
                    </td>
                    <td style={{ padding: "11px 12px", fontSize: 13, maxWidth: 180 }}><Truncate text={ex.detail} max={25} /></td>
                    <td style={{ padding: "11px 12px", fontSize: 12, color: "#777", maxWidth: 140 }}><Truncate text={ev?.name} max={18} /></td>
                    <td style={{ padding: "11px 12px", fontSize: 13, textAlign: "center" }}>{ex.qty}</td>
                    <td style={{ padding: "11px 12px", fontSize: 13, whiteSpace: "nowrap" }}>{fmt(ex.unit_price ?? 0, evSym)}</td>
                    <td style={{ padding: "11px 12px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{fmt(t, evSym)}</td>
                    <td style={{ padding: "11px 12px", fontSize: 12, color: "#2E7D32", fontWeight: 700, whiteSpace: "nowrap" }}>{fmt(share, evSym)}</td>
                    <td style={{ padding: "11px 12px" }}>
                      {ex.is_unpaid ? (
                        <span style={{ background: "#FFF8E1", color: "#F57F17", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 8 }}>⏳ Non réglée</span>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Avatar name={ex.paid_by || "?"} size={20} />
                          <span style={{ fontSize: 12, maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.paid_by}</span>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "11px 12px" }}><AvatarStack names={inc} size={20} /></td>
                    <td style={{ padding: "11px 12px" }}>
                      {ev?.status === "open" && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => startEdit(ex)} style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #e0e0e0", background: "#fff", fontSize: 12, cursor: "pointer" }}>✏️</button>
                          <button onClick={() => handleDelete(ex)} style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #ffcdd2", background: "#fff5f5", fontSize: 12, cursor: "pointer" }}>🗑️</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RÉPARTITION ─────────────────────────────────────────────
function Balance({ events, expenses, contributions, user, reload, isMobile, addToast, t }) {
  const [filterEvent, setFilterEvent] = useState(events[0]?.id || "");
  const [settleModal, setSettleModal] = useState(null);
  const [versement, setVersement] = useState({});
  const [saving, setSaving] = useState(false);
  const [emojiPickerFor, setEmojiPickerFor] = useState(null);
  const [, forceUpdate] = useState(0); // Force re-render après changement d'emoji

  const ev = events.find(e => e.id === filterEvent);
  const evExp = expenses.filter(e => e.event_id === filterEvent);
  const sym = currencySymbol(ev?.currency);
  const participants = (ev?.event_participants || []).map(p => p.name);
  const evContribMap = {};
  (contributions[filterEvent] || []).forEach(c => { evContribMap[c.participant] = c.amount; });

  // Nouvelle logique Solder :
  // - Débiteur (net < -1) : redistribue sa part aux créditeurs par priorité (celui à qui on doit le plus en premier)
  // - Cas exceptionnel (tout le monde équilibré mais des créditeurs subsistent) : ancienne logique
  const handleSettle = (person) => {
    const net = computeNetBalance(evExp, evContribMap, person);
    const owed = computeOwed(evExp, person);
    const current = evContribMap[person] || 0;

    if (net < -1) {
      // Débiteur : calcule vers qui redistribuer
      const debt = Math.abs(net);
      // Trouver les créditeurs (ceux qui ont trop payé), triés par montant décroissant
      const creditors = participants
        .filter(p => p !== person)
        .map(p => ({ name: p, net: computeNetBalance(evExp, evContribMap, p) }))
        .filter(p => p.net > 1)
        .sort((a, b) => b.net - a.net);

      let redistributionMsg = "";
      if (creditors.length > 0) {
        // Construire le message de redistribution
        let remaining = debt;
        const parts = [];
        for (const c of creditors) {
          if (remaining <= 0.01) break;
          const pay = Math.min(remaining, c.net);
          parts.push(`${fmt(pay, sym)} → ${c.name}`);
          remaining -= pay;
        }
        redistributionMsg = `\n\nRépartition : ${parts.join(", ")}${remaining > 0.01 ? ` (reste ${fmt(remaining, sym)} non attribué)` : ""}`;
      }

      const newAmount = current + debt;
      const message = `Versement de ${fmt(debt, sym)} enregistré pour ${person}.${redistributionMsg}`;
      setSettleModal({ person, newAmount, message });
    } else if (net > 1) {
      // Cas exceptionnel : créditeur mais tout le monde est équilibré par ailleurs
      const allOthersSettled = participants
        .filter(p => p !== person)
        .every(p => Math.abs(computeNetBalance(evExp, evContribMap, p)) <= 1);
      if (allOthersSettled) {
        const newAmount = owed;
        const message = `Contribution de ${person} ajustée à ${fmt(owed, sym)}. L'excédent est annulé.`;
        setSettleModal({ person, newAmount, message });
      }
    }
  };

  const confirmSettle = async () => {
    if (!settleModal) return;
    setSaving(true);
    await upsertContribution(filterEvent, settleModal.person, settleModal.newAmount, user.id);
    await reload();
    addToast(`${settleModal.person} soldé avec succès.`, "success");
    setSaving(false); setSettleModal(null);
  };

  const handleVersement = async (person) => {
    const amount = parseFloat(versement[person] || 0);
    if (!amount || amount <= 0) { addToast("Entrez un montant valide.", "warning"); return; }
    const current = evContribMap[person] || 0;
    setSaving(true);
    await upsertContribution(filterEvent, person, current + amount, user.id);
    await recordPayment(filterEvent, person, amount, null, user.id);
    await reload();
    setVersement(v => ({ ...v, [person]: "" }));
    addToast(`Versement de ${fmt(amount, sym)} enregistré pour ${person}.`, "success");
    setSaving(false);
  };

  const transactions = participants.length > 0 ? computeTransactions(evExp, evContribMap, participants) : [];

  const handleExportPDF = () => {
    if (!ev) return;
    exportPDF(ev, evExp, evContribMap, participants);
    addToast("PDF généré !", "success");
  };

  const handleExportExcel = () => {
    if (!ev || evExp.length === 0) { addToast("Aucune charge à exporter.", "warning"); return; }
    try {
      const sym = currencySymbol(ev.currency);
      // Données charges
      const expRows = evExp.map(ex => ({
        "Catégorie": ex.category || "",
        "Sous-catégorie": ex.sub_category || "",
        "Description": ex.detail || "",
        "Quantité": ex.qty,
        "Prix unitaire": ex.unit_price ?? 0,
        "Total": ex.qty * (ex.unit_price ?? 0),
        "Devise": sym,
        "Payé par": ex.is_unpaid ? "⏳ Non réglée" : (ex.paid_by || ""),
        "Participants": (ex.included || []).join(", "),
        "Commentaire": ex.comment || "",
      }));

      // Données soldes
      const balRows = participants.map(p => {
        const owed = computeOwed(evExp, p);
        const paid = evContribMap[p] || 0;
        const net = paid - owed;
        return {
          "Participant": p,
          "Part due": owed,
          "Versé": paid,
          "Solde": net,
          "Statut": Math.abs(net) <= 1 ? "Soldé" : net < 0 ? "Doit rembourser" : "À recevoir",
        };
      });

      // Créer le workbook manuellement (CSV multi-feuilles simulé)
      const toCSV = (rows) => {
        if (!rows.length) return "";
        const headers = Object.keys(rows[0]);
        const lines = [headers.join(";"), ...rows.map(r => headers.map(h => `"${r[h]}"`).join(";"))];
        return lines.join("\n");
      };

      const content = `CHARGES - ${ev.name}\n${toCSV(expRows)}\n\n\nSOLDES - ${ev.name}\n${toCSV(balRows)}`;
      const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SplitLy_${ev.name.replace(/\s+/g, "_")}_${ev.date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      addToast("Export CSV téléchargé !", "success");
    } catch (e) {
      addToast("Erreur lors de l'export.", "error");
    }
  };

  return (
    <div>
      {settleModal && (
        <Modal title={`Solder ${settleModal.person}`} onClose={() => setSettleModal(null)}>
          <p style={{ fontSize: 14, color: "#444", marginBottom: 16, lineHeight: 1.5 }}>{settleModal.message}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={confirmSettle} disabled={saving} style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex" }}>{saving ? "..." : "✓ Confirmer"}</button>
            <button onClick={() => setSettleModal(null)} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
          </div>
        </Modal>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>{t ? t("bal_title") : "Répartition"}</h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>{t ? t("bal_subtitle") : "Soldes calculés en temps réel"}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <button onClick={handleExportPDF} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>{t ? t("bal_pdf") : "📄 PDF"}</button>
          <button onClick={handleExportExcel} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>📊 CSV</button>
        </div>
      </div>

      {participants.length === 0 ? (
        <EmptyState icon="👥" title={t ? t("bal_no_participants") : "Aucun participant"} subtitle={t ? t("bal_select_event") : "Sélectionnez un événement avec des participants."} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(Math.max(isMobile ? 2 : participants.length, 1), isMobile ? 2 : 4)}, 1fr)`, gap: 12, marginBottom: 20 }}>
            {participants.map(p => {
              const owed = computeOwed(evExp, p);
              const contrib = evContribMap[p] || 0;
              const net = contrib - owed;
              const settled = isSettled(net);
              const hasCharges = owed > 0;
              const status = settleStatus(net, hasCharges);
              return (
                <div key={p} style={{ background: "#fff", borderRadius: 14, padding: "16px 12px", border: `2px solid ${settled && hasCharges ? "#c8e6c9" : !hasCharges ? "#f0f0f0" : Math.abs(net) > 10 ? "#ffcdd2" : "#eee"}`, textAlign: "center", transition: "border-color 0.2s", position: "relative" }}>
                  {/* Bouton emoji */}
                  <button onClick={() => setEmojiPickerFor(emojiPickerFor === p ? null : p)}
                    title="Changer l'avatar"
                    style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", cursor: "pointer", fontSize: 14, opacity: 0.4, padding: 2 }}>
                    🎨
                  </button>
                  {emojiPickerFor === p && (
                    <div style={{ position: "absolute", top: 30, right: 0, zIndex: 100 }}>
                      <EmojiPicker name={p} onClose={() => { setEmojiPickerFor(null); forceUpdate(n => n + 1); }} />
                    </div>
                  )}
                  <Avatar name={p} size={36} />
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</div>
                  <div style={{ fontSize: 10, color: "#aaa", marginTop: 4 }}>{hasCharges ? `${t ? t("bal_owes") : "Doit:"} ${fmt(owed, sym)}` : (t ? t("bal_no_charges") : "Aucune charge")}</div>
                  <div style={{ fontSize: 10, color: "#aaa" }}>{hasCharges ? `${t ? t("bal_paid") : "Versé:"} ${fmt(contrib, sym)}` : ""}</div>
                  <div style={{ marginTop: 8, padding: "5px 8px", borderRadius: 8, background: status.bg, fontSize: 12, fontWeight: 700, color: status.color }}>
                    {status.label}
                  </div>
                  {(() => {
                    const isDebtor = !settled && hasCharges && net < -1 && ev?.status === "open";
                    const allOthersSettled = participants
                      .filter(x => x !== p)
                      .every(x => Math.abs(computeNetBalance(evExp, evContribMap, x)) <= 1);
                    const isExceptionalCreditor = !settled && hasCharges && net > 1 && allOthersSettled && ev?.status === "open";
                    return (isDebtor || isExceptionalCreditor) ? (
                    <div style={{ marginTop: 10, display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                      <input type="number" placeholder="Montant" min="0.01" step="0.01"
                        style={{ ...S.input, width: 68, padding: "5px 6px", fontSize: 11, textAlign: "center" }}
                        value={versement[p] || ""} onChange={e => setVersement(v => ({ ...v, [p]: e.target.value }))} />
                      <button onClick={() => handleVersement(p)} disabled={saving} style={{ ...S.btnDark, padding: "5px 8px", fontSize: 11, borderRadius: 8 }}>+</button>
                      <button onClick={() => handleSettle(p)} style={{ padding: "5px 8px", borderRadius: 8, border: "1.5px solid #2E7D32", background: "#E8F5E9", color: "#2E7D32", fontSize: 11, cursor: "pointer", fontWeight: 700, width: "100%" }}>
                        Solder
                      </button>
                    </div>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>

          {/* Résumé en langage naturel */}
          {transactions.length > 0 && (
            <div style={{ background: "#FFF8E1", borderRadius: 12, padding: "14px 18px", marginBottom: 16, border: "1px solid #FFE082" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#E65100", marginBottom: 8 }}>{t ? t("bal_summary") : "💬 En résumé"}</div>
              {transactions.map((tx, i) => (
                <div key={i} style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>
                  <strong>{tx.from}</strong> {t ? t("bal_must_pay") : "doit rembourser"} <strong>{fmt(tx.amount, sym)}</strong> {t ? t("bal_to") : "à"} <strong>{tx.to}</strong>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #eee", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t ? t("bal_reimbursements") : "Remboursements à effectuer"}</div>
              <span style={{ background: transactions.length > 0 ? "#FFF8E1" : "#E8F5E9", color: transactions.length > 0 ? "#F57F17" : "#2E7D32", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>
                {transactions.length > 0 ? `${transactions.length} ${t ? t("bal_pending") : "en attente"}` : participants.every(p => isExactlySettled(computeNetBalance(evExp, evContribMap, p))) ? (t ? t("bal_all_settled") : "✓ Tout soldé exactement") : "≈ Tout soldé (écarts < 1)"}
              </span>
            </div>
            {transactions.length === 0 ? (
              <EmptyState icon="🎉" title={t ? t("bal_no_reimbursements") : "Aucun remboursement nécessaire"} subtitle={t ? t("bal_all_balanced") : "Tous les soldes sont équilibrés."} />
            ) : (
              transactions.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: i < transactions.length - 1 ? "1px solid #f5f5f5" : "none" }}>
                  <Avatar name={t.from} size={30} />
                  <div style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
                    <span style={{ fontWeight: 700 }}><Truncate text={t.from} max={12} /></span>
                    <span style={{ color: "#aaa", margin: "0 6px" }}>→</span>
                    <span style={{ fontWeight: 700 }}><Truncate text={t.to} max={12} /></span>
                  </div>
                  <Avatar name={t.to} size={30} />
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Playfair Display', serif", flexShrink: 0 }}>{fmt(t.amount, sym)}</div>
                </div>
              ))
            )}
          </div>

          {/* Historique des versements */}
          <PaymentHistory eventId={filterEvent} sym={sym} />
        </>
      )}
    </div>
  );
}

// ─── HISTORIQUE DES VERSEMENTS ────────────────────────────────
function PaymentHistory({ eventId, sym }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!eventId || !show) return;
    setLoading(true);
    fetchPayments(eventId).then(({ data }) => {
      setPayments(data || []);
      setLoading(false);
    });
  }, [eventId, show]);

  return (
    <div style={{ marginTop: 16 }}>
      <button onClick={() => setShow(!show)}
        style={{ background: "#fafafa", border: "1px solid #eee", borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer", fontWeight: 600, width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>📋 Historique des versements</span>
        <span style={{ fontSize: 12, color: "#aaa" }}>{show ? "▲ Masquer" : "▼ Afficher"}</span>
      </button>
      {show && (
        <div style={{ background: "#fff", borderRadius: "0 0 12px 12px", border: "1px solid #eee", borderTop: "none", overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>Chargement...</div>
          ) : payments.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>Aucun versement enregistré.</div>
          ) : (
            payments.map((p, i) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < payments.length - 1 ? "1px solid #f5f5f5" : "none" }}>
                <Avatar name={p.participant} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.participant}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{new Date(p.created_at).toLocaleString("fr-FR")}</div>
                  {p.note && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>💬 {p.note}</div>}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#2E7D32" }}>+{fmt(p.amount, sym)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
function GuestEditExpenseForm({ expense, events, onSubmit, onCancel, saving }) {
  const ev = events.find(e => e.id === expense.event_id);
  const participants = (ev?.event_participants || []).map(p => p.name);
  const [form, setForm] = useState({
    category: expense.category || "",
    sub: expense.sub_category || "",
    detail: expense.detail || "",
    qty: expense.qty || 1,
    unit: expense.unit_price || 0,
    paidBy: expense.paid_by || "",
    included: expense.included || [...participants],
    comment: expense.comment || "",
  });
  const total = (Number(form.qty) || 0) * (Number(form.unit) || 0);
  const sym = currencySymbol(ev?.currency);

  return (
    <div style={{ ...S.card, border: "1.5px solid #F57F17", marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: "#E65100" }}>✏️ Demande de modification</div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>
        Charge : <strong>{expense.detail}</strong> · Événement : <strong>{ev?.name}</strong>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div><label style={S.label}>Catégorie</label>
          <select style={S.input} value={form.category} onChange={e => setForm({ ...form, category: e.target.value, sub: "" })}>
            {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{CATEGORIES[c].icon} {c}</option>)}
          </select>
        </div>
        <div><label style={S.label}>Sous-catégorie</label>
          <select style={S.input} value={form.sub} onChange={e => setForm({ ...form, sub: e.target.value })}>
            {form.category && CATEGORIES[form.category]?.subs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>Description</label>
          <input style={S.input} value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} />
        </div>
        <div><label style={S.label}>Quantité</label>
          <input type="number" style={S.input} value={form.qty} min={1} onChange={e => setForm({ ...form, qty: Number(e.target.value) })} />
        </div>
        <div><label style={S.label}>Prix unitaire</label>
          <input type="number" style={S.input} value={form.unit} min={0} step={0.01} onChange={e => setForm({ ...form, unit: e.target.value })} />
        </div>
        <div><label style={S.label}>Payé par</label>
          <select style={S.input} value={form.paidBy} onChange={e => setForm({ ...form, paidBy: e.target.value })}>
            <option value="">Sélectionner...</option>
            {participants.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#0F0F0F" }}>
            Total : {fmt(total, sym)}
          </span>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Qui partage ?</label>
        <ParticipantToggle people={participants} selected={form.included} onChange={p => setForm({ ...form, included: p })} label="" />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={S.label}>Commentaire (optionnel)</label>
        <textarea style={{ ...S.input, minHeight: 56, resize: "vertical", fontFamily: "inherit" }}
          placeholder="Expliquez pourquoi vous souhaitez modifier cette charge..."
          value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} maxLength={300}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onSubmit(form)} disabled={saving}
          style={{ ...S.btnDark, background: "#E65100", flex: 1 }}>
          {saving ? "Envoi..." : "📤 Soumettre la modification"}
        </button>
        <button onClick={onCancel} style={S.btnGhost}>Annuler</button>
      </div>
    </div>
  );
}
function Analytics({ events, expenses, contributions, isMobile, t }) {
  const [tab, setTab] = useState("all"); // "all" | "event" | "charges" | "personal"
  const [sel, setSel] = useState(events[0]?.id || "");

  // ── Données événement sélectionné ─────────────────────────
  const ev = events.find(e => e.id === sel);
  const evExp = expenses.filter(e => e.event_id === sel);
  const sym = currencySymbol(ev?.currency);
  const budget = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const participants = (ev?.event_participants || []).map(p => p.name);
  const evContribMap = {};
  (contributions[sel] || []).forEach(c => { evContribMap[c.participant] = c.amount; });
  const byCategory = Object.keys(CATEGORIES).map(cat => ({
    cat, total: evExp.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0)
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  // ── Données tous événements (onglet "Tous") ───────────────
  const allTotal = expenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const evRows = events.map(ev => {
    const exps = expenses.filter(e => e.event_id === ev.id);
    const total = exps.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
    const parts = (ev.event_participants || []).map(p => p.name);
    const contribs = {};
    (contributions[ev.id] || []).forEach(c => { contribs[c.participant] = c.amount; });
    const settled = parts.filter(p => isSettled(computeNetBalance(exps, contribs, p))).length;
    const pct = parts.length > 0 ? Math.round((settled / parts.length) * 100) : 0;
    return { ev, total, parts, settled, pct, expCount: exps.length, sym: currencySymbol(ev.currency) };
  });

  // ── Données par charge (onglet "Par charge") ──────────────
  const allByCat = Object.keys(CATEGORIES).map(cat => {
    const catExps = expenses.filter(e => e.category === cat);
    const total = catExps.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
    const count = catExps.length;
    const avg = count > 0 ? total / count : 0;
    const max = catExps.reduce((m, e) => Math.max(m, e.qty * (e.unit_price ?? 0)), 0);
    return { cat, total, count, avg, max };
  }).filter(c => c.count > 0).sort((a, b) => b.total - a.total);
  const topExpenses = [...expenses].sort((a, b) => (b.qty * (b.unit_price ?? 0)) - (a.qty * (a.unit_price ?? 0))).slice(0, 8);

  // ── Données par participant ───────────────────────────────
  const allParticipants = [...new Set(events.flatMap(e => (e.event_participants || []).map(p => p.name)))].sort();
  const [selParticipant, setSelParticipant] = useState(allParticipants[0] || "");

  const personalStats = (name) => {
    const pEvents = events.filter(ev => (ev.event_participants || []).some(p => p.name === name));
    let totalOwed = 0, totalPaid = 0, totalAdvanced = 0, expenseCount = 0;
    const byEv = pEvents.map(ev => {
      const evExps = expenses.filter(e => e.event_id === ev.id);
      const owed = computeOwed(evExps, name);
      const evContribs = {};
      (contributions[ev.id] || []).forEach(c => { evContribs[c.participant] = c.amount; });
      const paid = evContribs[name] || 0;
      const advanced = evExps.filter(e => e.paid_by === name).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
      const net = paid - owed;
      totalOwed += owed; totalPaid += paid; totalAdvanced += advanced;
      expenseCount += evExps.filter(e => (e.included || []).includes(name)).length;
      return { ev, owed, paid, advanced, net };
    });
    const favCat = Object.entries(
      expenses.filter(e => (e.included || []).includes(name))
        .reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + 1; return acc; }, {})
    ).sort((a, b) => b[1] - a[1])[0];
    return { pEvents, byEv, totalOwed, totalPaid, totalAdvanced, expenseCount, netGlobal: totalPaid - totalOwed, favCat };
  };
  const ps = selParticipant ? personalStats(selParticipant) : null;

  const allCurrencies = [...new Set(events.map(e => e.currency))];
  const mixedCurrencies = allCurrencies.length > 1;

  const TABS = [
    { key: "all",      label: "🌐 Tous" },
    { key: "event",    label: "📊 Par événement" },
    { key: "charges",  label: "🏷️ Par charge" },
    { key: "personal", label: "👤 Par participant" },
  ];

  const TabBar = () => (
    <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 12, padding: 3, gap: 2, flexWrap: "wrap" }}>
      {TABS.map(tb => (
        <button key={tb.key} onClick={() => setTab(tb.key)}
          style={{ padding: isMobile ? "6px 10px" : "7px 14px", borderRadius: 9, border: "none", background: tab === tb.key ? "#0F0F0F" : "transparent", color: tab === tb.key ? "#fff" : "var(--text-muted)", fontSize: isMobile ? 11 : 12, fontWeight: tab === tb.key ? 700 : 400, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap" }}>
          {tb.label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2, color: "var(--text)" }}>{t ? t("ana_title") : "Analyses"}</h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>{t ? t("ana_subtitle") : "Statistiques détaillées"}</p>
        </div>
        <TabBar />
      </div>

      {mixedCurrencies && (
        <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 12, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#E65100" }}>
          ⚠️ Devises mixtes ({allCurrencies.map(currencySymbol).join(", ")}) — montants non cumulables entre événements.
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET TOUS
      ══════════════════════════════════════════════════════ */}
      {tab === "all" && (
        <div>
          {/* KPIs globaux */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <StatCard label="Événements" value={events.length} sub={`${events.filter(e => e.status === "open").length} ouvert(s)`} accent="#0F0F0F" />
            <StatCard label="Charges totales" value={expenses.length} sub="toutes catégories" accent="#1565C0" />
            <StatCard label="Participants" value={allParticipants.length} sub="profils uniques" accent="#6A1B9A" />
            <StatCard label="Budget cumulé" value={fmt(allTotal)} sub="toutes devises" accent="#2E7D32" />
          </div>

          {/* Tableau synthèse par événement */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 20 }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              Synthèse par événement
            </div>
            {evRows.length === 0 ? <EmptyState icon="🎊" title="Aucun événement" subtitle="" /> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
                  <thead>
                    <tr style={{ background: "var(--hover-bg)" }}>
                      {["Événement", "Date", "Participants", "Charges", "Budget", "Progression"].map(h => (
                        <th key={h} style={{ padding: "10px 16px", fontSize: 10, fontWeight: 700, color: "var(--text-sub)", textAlign: "left", textTransform: "uppercase", letterSpacing: 0.7, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {evRows.map(({ ev, total, parts, settled, pct, expCount, sym }, i) => (
                      <tr key={ev.id} style={{ borderBottom: i < evRows.length - 1 ? "1px solid var(--border)" : "none" }}>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span>{ev.status === "closed" ? "🔒" : "🎊"}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}><Truncate text={ev.name} max={20} /></span>
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{ev.date}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text)", textAlign: "center" }}>{parts.length}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text)", textAlign: "center" }}>{expCount}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>{fmt(total, sym)}</td>
                        <td style={{ padding: "12px 16px", minWidth: 120 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, background: "var(--border)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                              <div style={{ background: pct === 100 ? "#2E7D32" : "#F57F17", height: 6, width: `${pct}%`, borderRadius: 4, transition: "width 0.5s" }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? "#2E7D32" : "#F57F17", flexShrink: 0 }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Top catégories global */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Top catégories — tous événements</div>
            {allByCat.slice(0, 6).map(c => (
              <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 18, width: 26, flexShrink: 0 }}>{CATEGORIES[c.cat].icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--text)" }}>{c.cat}</span>
                    <span style={{ fontSize: 11, color: "var(--text-sub)", flexShrink: 0, marginLeft: 8 }}>{c.count} charge{c.count > 1 ? "s" : ""}</span>
                  </div>
                  <div style={{ background: "var(--border)", borderRadius: 6, height: 6, overflow: "hidden" }}>
                    <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 6, height: 6, width: `${allTotal > 0 ? (c.total / allTotal) * 100 : 0}%`, transition: "width 0.5s" }} />
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", flexShrink: 0, minWidth: 52, textAlign: "right" }}>{fmt(c.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET PAR ÉVÉNEMENT
      ══════════════════════════════════════════════════════ */}
      {tab === "event" && (
        <div>
          {/* Sélecteur événement */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {events.map(ev => (
              <button key={ev.id} onClick={() => setSel(ev.id)}
                style={{ padding: "7px 14px", borderRadius: 20, border: `1.5px solid ${sel === ev.id ? "#0F0F0F" : "var(--border)"}`, background: sel === ev.id ? "#0F0F0F" : "var(--bg-secondary)", color: sel === ev.id ? "#fff" : "var(--text-muted)", fontSize: 12, cursor: "pointer", fontWeight: sel === ev.id ? 700 : 400, transition: "all 0.15s" }}>
                {ev.status === "closed" ? "🔒 " : ""}<Truncate text={ev.name} max={20} />
                <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 10 }}>({currencySymbol(ev.currency)})</span>
              </button>
            ))}
          </div>

          {!ev ? (
            <EmptyState icon="📊" title="Sélectionnez un événement" subtitle="Choisissez un événement pour voir ses statistiques." />
          ) : (
            <>
              {/* KPIs événement */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                <StatCard label="Budget collectif" value={fmt(budget, sym)} sub={`${evExp.length} charge${evExp.length > 1 ? "s" : ""}`} accent="#0F0F0F" />
                <StatCard label="Participants" value={participants.length} sub={`Moy. ${fmt(participants.length > 0 ? budget / participants.length : 0, sym)}/p.`} accent="#1565C0" />
                <StatCard label="Charge max" value={fmt(evExp.reduce((m, e) => Math.max(m, e.qty * (e.unit_price ?? 0)), 0), sym)} sub="dépense unitaire la plus élevée" accent="#F57F17" />
                <StatCard label="Statut" value={ev.status === "closed" ? "Bouclé 🔒" : "Ouvert ✓"} sub={`${ev.date} · ${sym}`} accent={ev.status === "closed" ? "#999" : "#2E7D32"} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                {/* Répartition par catégorie */}
                <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>Répartition par catégorie</div>
                  {byCategory.length === 0 ? <EmptyState icon="🧾" title="Aucune charge" subtitle="" /> : byCategory.map(c => (
                    <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ fontSize: 18, flexShrink: 0, width: 26 }}>{CATEGORIES[c.cat].icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: "var(--text)" }}>{c.cat}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{fmt(c.total, sym)} <span style={{ color: "var(--text-sub)", fontWeight: 400 }}>({budget > 0 ? ((c.total / budget) * 100).toFixed(0) : 0}%)</span></span>
                        </div>
                        <div style={{ background: "var(--border)", borderRadius: 6, height: 7, overflow: "hidden" }}>
                          <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 6, height: 7, width: `${budget > 0 ? (c.total / budget) * 100 : 0}%`, transition: "width 0.5s ease" }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Part due + progression par participant */}
                <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>Part due par participant</div>
                  {participants.length === 0 ? <EmptyState icon="👥" title="Aucun participant" subtitle="" /> : participants.map(p => {
                    const owed = computeOwed(evExp, p);
                    const paid = evContribMap[p] || 0;
                    const pct = owed > 0 ? Math.min((paid / owed) * 100, 100) : 100;
                    const net = paid - owed;
                    const settled = isSettled(net);
                    const status = settleStatus(net, owed > 0);
                    return (
                      <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                        <Avatar name={p} size={28} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                            <span style={{ fontSize: 11, color: status.color, fontWeight: 700, flexShrink: 0, marginLeft: 4 }}>
                              {settled ? "✓ Soldé" : `${fmt(paid, sym)} / ${fmt(owed, sym)}`}
                            </span>
                          </div>
                          <div style={{ background: "var(--border)", borderRadius: 6, height: 6, overflow: "hidden" }}>
                            <div style={{ background: status.color, borderRadius: 6, height: 6, width: `${pct}%`, transition: "width 0.4s ease" }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET PAR CHARGE
      ══════════════════════════════════════════════════════ */}
      {tab === "charges" && (
        <div>
          {/* KPIs charges */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <StatCard label="Total charges" value={expenses.length} sub="enregistrées" accent="#0F0F0F" />
            <StatCard label="Montant total" value={fmt(allTotal)} sub="toutes devises" accent="#1565C0" />
            <StatCard label="Moyenne/charge" value={fmt(expenses.length > 0 ? allTotal / expenses.length : 0)} sub="par dépense" accent="#F57F17" />
            <StatCard label="Catégories actives" value={allByCat.length} sub={`sur ${Object.keys(CATEGORIES).length} disponibles`} accent="#2E7D32" />
          </div>

          {/* Barres horizontales par catégorie */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Volume par catégorie</div>
            {allByCat.map(c => (
              <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <span style={{ fontSize: 18, width: 26, flexShrink: 0 }}>{CATEGORIES[c.cat].icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{c.cat}</span>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-sub)", flexShrink: 0 }}>
                      <span>{c.count} charge{c.count > 1 ? "s" : ""}</span>
                      <span>moy. {fmt(c.avg)}</span>
                      <span style={{ fontWeight: 700, color: "var(--text)" }}>{fmt(c.total)}</span>
                    </div>
                  </div>
                  <div style={{ background: "var(--border)", borderRadius: 6, height: 8, overflow: "hidden" }}>
                    <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 6, height: 8, width: `${allTotal > 0 ? (c.total / allTotal) * 100 : 0}%`, transition: "width 0.5s" }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Top 8 charges */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              Top charges par montant
            </div>
            {topExpenses.map((ex, i) => {
              const cat = CATEGORIES[ex.category];
              const evItem = events.find(e => e.id === ex.event_id);
              const total = ex.qty * (ex.unit_price ?? 0);
              const evSym = currencySymbol(evItem?.currency);
              const maxTotal = topExpenses[0] ? topExpenses[0].qty * (topExpenses[0].unit_price ?? 0) : 1;
              return (
                <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: i < topExpenses.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontSize: 16, color: "var(--text-sub)", fontWeight: 700, width: 20, flexShrink: 0 }}>#{i + 1}</span>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{cat?.icon || "🧾"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail || "—"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <div style={{ flex: 1, background: "var(--border)", borderRadius: 4, height: 4, overflow: "hidden" }}>
                        <div style={{ background: cat?.accent || "#aaa", height: 4, width: `${(total / maxTotal) * 100}%`, borderRadius: 4, transition: "width 0.4s" }} />
                      </div>
                      <span style={{ fontSize: 10, color: "var(--text-sub)", flexShrink: 0 }}>{evItem?.name}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{fmt(total, evSym)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET PAR PARTICIPANT
      ══════════════════════════════════════════════════════ */}
      {tab === "personal" && (
        <div>
          {/* Sélecteur participant */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {allParticipants.map(p => (
                <button key={p} onClick={() => setSelParticipant(p)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 20, border: `1.5px solid ${selParticipant === p ? "#0F0F0F" : "var(--border)"}`, background: selParticipant === p ? "#0F0F0F" : "var(--bg-secondary)", color: selParticipant === p ? "#fff" : "var(--text-muted)", fontSize: 13, cursor: "pointer", fontWeight: selParticipant === p ? 700 : 400, transition: "all 0.15s" }}>
                  <Avatar name={p} size={20} />
                  {p}
                </button>
              ))}
            </div>
          </div>

          {ps ? (
            <div>
              {/* KPIs participant */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                <StatCard label="Part due totale" value={fmt(ps.totalOwed)} sub={`${ps.expenseCount} charge(s)`} accent="#C62828" />
                <StatCard label="Total avancé" value={fmt(ps.totalAdvanced)} sub="payé pour les autres" accent="#1565C0" />
                <StatCard label="Solde global" value={`${ps.netGlobal >= 0 ? "+" : ""}${fmt(ps.netGlobal)}`} sub={ps.netGlobal >= 0 ? "à recevoir" : "à rembourser"} accent={ps.netGlobal >= 0 ? "#2E7D32" : "#C62828"} />
                <StatCard label="Événements" value={ps.pEvents.length} sub={ps.favCat ? `Fav: ${ps.favCat[0]}` : "—"} accent="#6A1B9A" />
              </div>

              {/* Catégorie favorite */}
              {ps.favCat && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 14, border: "1px solid var(--border)", padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontSize: 28 }}>{CATEGORIES[ps.favCat[0]]?.icon || "🏷️"}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Catégorie préférée : {ps.favCat[0]}</div>
                    <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{ps.favCat[1]} charge{ps.favCat[1] > 1 ? "s" : ""} dans cette catégorie</div>
                  </div>
                </div>
              )}

              {/* Détail par événement */}
              <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                  Détail par événement
                </div>
                {ps.byEv.map(({ ev, owed, paid, advanced, net }) => {
                  const evSym = currencySymbol(ev.currency);
                  const hasCharges = owed > 0;
                  const status = settleStatus(net, hasCharges);
                  const pct = owed > 0 ? Math.min((paid / owed) * 100, 100) : 100;
                  return (
                    <div key={ev.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: hasCharges ? 8 : 0, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 16 }}>{ev.status === "closed" ? "🔒" : "🎊"}</span>
                        <div style={{ flex: 1, minWidth: 100 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}><Truncate text={ev.name} max={25} /></div>
                          <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{ev.date} · {evSym}</div>
                        </div>
                        {hasCharges && (
                          <div style={{ fontSize: 11, color: "var(--text-sub)" }}>
                            Doit {fmt(owed, evSym)} · Avancé {fmt(advanced, evSym)}
                          </div>
                        )}
                        <span style={{ padding: "4px 10px", borderRadius: 20, background: status.bg, color: status.color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                          {status.label}
                        </span>
                      </div>
                      {hasCharges && (
                        <div style={{ background: "var(--border)", borderRadius: 4, height: 5, overflow: "hidden" }}>
                          <div style={{ background: status.color, height: 5, width: `${pct}%`, borderRadius: 4, transition: "width 0.4s" }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState icon="👤" title="Sélectionnez un participant" subtitle="Choisissez un participant pour voir ses statistiques." />
          )}
        </div>
      )}
    </div>
  );
}

// ─── HISTORIQUE ───────────────────────────────────────────────
function History({ events, history, user, reload, isMobile, addToast }) {
  const [filterEvent, setFilterEvent] = useState("all");
  const [confirm, setConfirm] = useState(null);
  const filtered = filterEvent === "all" ? history : history.filter(h => h.event_id === filterEvent);

  const handleRollback = (entry) => {
    const later = history.filter(h => h.event_id === entry.event_id && h.created_at >= entry.created_at && !h.invalidated);
    setConfirm({
      message: `Invalider "${entry.action}" du ${new Date(entry.created_at).toLocaleString("fr-FR")} ?`,
      warnings: later.length > 1 ? [`${later.length - 1} modification(s) ultérieure(s) seront également invalidées.`] : [],
      onConfirm: async () => {
        try {
          const before = entry.before_data;
          const after = entry.after_data;

          if (entry.action === "Charge modifiée" && before) {
            const { error } = await supabase.from('expenses').update({
              category: before.category, sub_category: before.sub_category,
              detail: before.detail, qty: before.qty, unit_price: before.unit_price,
              paid_by: before.paid_by, included: before.included, version: before.version,
            }).eq('id', before.id);
            if (error) throw new Error("Restauration impossible : " + error.message);

          } else if (entry.action === "Charge supprimée" && before) {
            const { error } = await supabase.from('expenses').insert({
              id: before.id, event_id: before.event_id, category: before.category,
              sub_category: before.sub_category, detail: before.detail, qty: before.qty,
              unit_price: before.unit_price, paid_by: before.paid_by, included: before.included,
              created_by: before.created_by,
            });
            if (error) throw new Error("Impossible de restaurer la charge : " + error.message);

          } else if (entry.action === "Charge ajoutée" && after) {
            const { error } = await supabase.from('expenses').delete().eq('id', after.id);
            if (error) throw new Error("Impossible d'annuler l'ajout : " + error.message);

          } else if (entry.action.startsWith("Contribution") && before) {
            const person = before.participant;
            if (person) {
              if (!before.amount || before.amount === 0) {
                await supabase.from('contributions').delete().eq('event_id', entry.event_id).eq('participant', person);
              } else {
                await supabase.from('contributions').upsert({ event_id: entry.event_id, participant: person, amount: before.amount }, { onConflict: 'event_id,participant' });
              }
            }
          } else {
            addToast("Ce type de modification ne peut pas être annulé automatiquement.", "warning");
            setConfirm(null);
            return;
          }

          await invalidateHistory(entry.id, entry.event_id);
          await reload();
          setConfirm(null);
          addToast("✓ Rollback effectué — données restaurées.", "success");

        } catch (err) {
          setConfirm(null);
          addToast("Rollback impossible : " + err.message, "error");
        }
      },
      onCancel: () => setConfirm(null),
    });
  };

  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>Historique</h2>
          <p style={{ color: "#888", fontSize: 12 }}>Toutes les modifications · Rollback disponible</p>
        </div>
        <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          <option value="all">Tous les événements</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="📋" title="Aucune modification" subtitle="L'historique des modifications apparaîtra ici." />
      ) : (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #eee", overflow: "hidden" }}>
          {[...filtered].reverse().map((h, i) => {
            const ev = events.find(e => e.id === h.event_id);
            const color = h.invalidated ? "#ddd" : h.action.includes("supprim") ? "#C62828" : h.action.includes("ajout") || h.action.includes("créé") ? "#2E7D32" : "#1565C0";
            return (
              <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", borderBottom: i < filtered.length - 1 ? "1px solid #f5f5f5" : "none", opacity: h.invalidated ? 0.4 : 1, transition: "opacity 0.2s" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {h.action} {h.invalidated && <span style={{ fontSize: 10, color: "#aaa", fontWeight: 400 }}>(invalidé)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                    {ev?.name || "–"} · {new Date(h.created_at).toLocaleString("fr-FR")}
                  </div>
                </div>
                {!h.invalidated && ev?.status === "open" && (
                  <button onClick={() => handleRollback(h)} style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" }}>
                    ↩ Invalider
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── INVITATIONS ──────────────────────────────────────────────
function Invite({ events, user, isMobile, addToast }) {
  const [email, setEmail] = useState("");
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [role, setRole] = useState("read");
  const [invitations, setInvitations] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadInvites = async () => {
    const all = [];
    for (const ev of events) {
      const { data } = await fetchInvitations(ev.id);
      if (data) all.push(...data.map(i => ({ ...i, eventName: ev.name })));
    }
    setInvitations(all);
  };

  useEffect(() => { if (events.length > 0) loadInvites(); }, [events]);

  const handleSend = async () => {
    if (!email) { addToast("Entrez un email.", "warning"); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { addToast("Format d'email invalide.", "warning"); return; }
    if (selectedEvents.length === 0) { addToast("Sélectionnez au moins un événement.", "warning"); return; }
    setSaving(true);
    for (const evId of selectedEvents) await sendInvitation({ eventId: evId, email, role, invitedBy: user.id });
    setEmail(""); setSelectedEvents([]); setRole("read");
    await loadInvites();
    setSaving(false);
    addToast(`Invitation envoyée à ${email}.`, "success");
  };

  const handleRemove = async (inv) => {
    await removeInvitation(inv.event_id, inv.email);
    await loadInvites();
    addToast("Accès retiré.", "info");
  };

  const handleToggleRole = async (inv) => {
    const newRole = inv.role === "read" ? "edit" : "read";
    await updateInvitationRole(inv.event_id, inv.email, newRole);
    await loadInvites();
    addToast(`Rôle de ${inv.email} mis à jour.`, "success");
  };

  return (
    <div>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 4 }}>Invitations</h2>
      <p style={{ color: "#888", fontSize: 12, marginBottom: 20 }}>Gérez l'accès de vos invités aux événements</p>

      <div style={S.card}>
        <div style={S.sectionTitle}>✉️ Inviter quelqu'un</div>
        <div style={{ background: "#E8F5E9", borderRadius: 10, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#2E7D32" }}>
          L'invité recevra un code d'accès par email pour se connecter en mode invité.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div><label style={S.label}>Email de l'invité</label><input style={S.input} type="email" placeholder="ami@example.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div><label style={S.label}>Niveau d'accès</label>
            <select style={S.input} value={role} onChange={e => setRole(e.target.value)}>
              <option value="read">👁 Lecture seule</option>
              <option value="edit">✏️ Peut soumettre des charges</option>
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Événements accessibles</label>
          {events.length === 0 ? <div style={{ color: "#aaa", fontSize: 13, padding: "8px 0" }}>Aucun événement créé</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {events.map(ev => (
                <label key={ev.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, padding: "8px 12px", borderRadius: 10, background: selectedEvents.includes(ev.id) ? "#f0faf4" : "#fafafa", border: `1px solid ${selectedEvents.includes(ev.id) ? "#c8e6c9" : "#eee"}`, transition: "all 0.15s" }}>
                  <input type="checkbox" checked={selectedEvents.includes(ev.id)} onChange={() => setSelectedEvents(s => s.includes(ev.id) ? s.filter(x => x !== ev.id) : [...s, ev.id])} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</span>
                  <span style={{ color: "#aaa", fontSize: 11, flexShrink: 0 }}>{ev.date}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <button onClick={handleSend} disabled={saving} style={S.btnDark}>{saving ? "Envoi..." : "Envoyer l'invitation ✉️"}</button>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #eee", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0f0", fontSize: 14, fontWeight: 700 }}>
          Invités ({invitations.length})
        </div>
        {invitations.length === 0 ? (
          <EmptyState icon="👥" title="Aucun invité" subtitle="Invitez des personnes à consulter vos événements." />
        ) : (
          invitations.map((inv, i) => (
            <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: i < invitations.length - 1 ? "1px solid #f5f5f5" : "none", flexWrap: "wrap", gap: 10 }}>
              <Avatar name={inv.email[0]} size={32} />
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.email}</div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}><Truncate text={inv.eventName} max={25} /></div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: inv.status === "accepted" ? "#E8F5E9" : "#FFF8E1", color: inv.status === "accepted" ? "#2E7D32" : "#F57F17", flexShrink: 0 }}>
                {inv.status === "accepted" ? "✓ Accepté" : "⏳ En attente"}
              </span>
              <button onClick={() => handleToggleRole(inv)} style={{ padding: "4px 10px", borderRadius: 8, border: `1.5px solid ${inv.role === "edit" ? "#90CAF9" : "#e0e0e0"}`, background: inv.role === "edit" ? "#E3F2FD" : "#fff", color: inv.role === "edit" ? "#1565C0" : "#666", fontSize: 11, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                {inv.role === "edit" ? "✏️ Éditeur" : "👁 Lecture"}
              </button>
              <button onClick={() => handleRemove(inv)} style={{ padding: "4px 10px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>
                Retirer
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── NOTIFICATIONS ────────────────────────────────────────────
function NotificationsPage({ notifications, events, expenses, pendingActions, user, onMarkAll, onDismiss, reload, isMobile, addToast }) {
  const [saving, setSaving] = useState(null);

  const handleApprove = async (action) => {
    setSaving(action.id);
    // S'assurer que la structure est correcte pour approvePendingAction
    const { error } = await approvePendingAction(action.id, user.id, {
      action_type: action.action_type,
      action_data: action.action_data,
    });
    if (error) {
      addToast("Erreur lors de l'approbation : " + error.message, "error");
    } else {
      addToast("Action approuvée et exécutée.", "success");
    }
    await reload();
    setSaving(null);
  };

  const handleReject = async (action) => {
    setSaving(action.id);
    await rejectPendingAction(action.id, user.id);
    await reload();
    setSaving(null);
    addToast("Demande refusée.", "info");
  };

  const typeColor = (t) => ({ success: "#2E7D32", warning: "#F57F17", info: "#1565C0", request: "#6A1B9A" }[t] || "#888");
  const typeBg = (t) => ({ success: "#E8F5E9", warning: "#FFF8E1", info: "#E3F2FD", request: "#F3E5F5" }[t] || "#f8f8f8");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>Notifications</h2>
          <p style={{ color: "#888", fontSize: 12 }}>{notifications.filter(n => !n.is_read).length} non lue(s) · {pendingActions.length} demande(s)</p>
        </div>
        <button onClick={onMarkAll} style={S.btnGhost}>Tout marquer lu</button>
      </div>

      {pendingActions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6A1B9A", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 12 }}>
            ⏳ Demandes en attente d'approbation ({pendingActions.length})
          </div>
          {pendingActions.map(action => {
            const ev = events.find(e => e.id === action.event_id);
            const data = action.action_data;
            const total = ((data?.qty || 0) * (data?.unit || 0)).toFixed(2);
            const isModify = action.action_type === "modify_expense";
            const originalExp = expenses.find(e => e.id === data?.expense_id);
            return (
              <div key={action.id} style={{ background: isModify ? "#FFF3E0" : "#F3E5F5", borderRadius: 14, padding: "16px 18px", border: `1.5px solid ${isModify ? "#FFCC80" : "#ce93d8"}`, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 24, flexShrink: 0 }}>{isModify ? "✏️" : "📝"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isModify ? "#E65100" : "#6A1B9A", marginBottom: 6 }}>
                      {action.guest_email} {isModify ? "demande de modifier une charge" : "demande d'ajouter une charge"}
                    </div>
                    {isModify && originalExp && (
                      <div style={{ fontSize: 12, color: "#888", marginBottom: 4, fontStyle: "italic" }}>
                        Original : <strong>{originalExp.detail}</strong> → <strong>{data?.detail}</strong>
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>
                      <strong>{ev?.name}</strong> · {data?.detail} · <strong>{total} {currencySymbol(ev?.currency)}</strong>
                    </div>
                    <div style={{ fontSize: 11, color: "#888" }}>
                      Payé par : {data?.paidBy} · Inclus : {(data?.included || []).join(", ")}
                    </div>
                    {data?.comment && (
                      <div style={{ fontSize: 11, color: "#666", fontStyle: "italic", marginTop: 4 }}>💬 {data.comment}</div>
                    )}
                    <div style={{ fontSize: 10, color: "#aaa", marginTop: 4 }}>
                      {new Date(action.created_at).toLocaleString("fr-FR")}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleApprove(action)} disabled={saving === action.id}
                    style={{ ...S.btnDark, background: "#2E7D32", padding: "7px 16px", fontSize: 12, flex: 1, justifyContent: "center", display: "flex" }}>
                    {saving === action.id ? "..." : "✓ Approuver"}
                  </button>
                  <button onClick={() => handleReject(action)} disabled={saving === action.id}
                    style={{ padding: "7px 16px", borderRadius: 10, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 12, cursor: "pointer", fontWeight: 700, flex: 1 }}>
                    ✕ Refuser
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {notifications.length === 0 && pendingActions.length === 0 ? (
        <EmptyState icon="🔔" title="Aucune notification" subtitle="Vous êtes à jour ! Les notifications apparaîtront ici." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {notifications.map(n => {
            const ev = events.find(e => e.id === n.event_id);
            return (
              <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 16px", borderRadius: 14, background: n.is_read ? "#fafafa" : typeBg(n.type), border: `1px solid ${n.is_read ? "#eee" : typeColor(n.type) + "44"}`, transition: "all 0.15s" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: n.is_read ? "#e0e0e0" : typeColor(n.type), marginTop: 4, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: n.is_read ? "#999" : "#333", lineHeight: 1.4 }}>{n.message}</div>
                  {ev && <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>{ev.name} · {new Date(n.created_at).toLocaleString("fr-FR")}</div>}
                </div>
                <button onClick={() => onDismiss(n.id)} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 18, padding: 0, flexShrink: 0, lineHeight: 1 }}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PAGE PARAMÈTRES ─────────────────────────────────────────
function SettingsPage({ user, onSignOut, isMobile, addToast }) {
  const { dark, toggle } = useTheme();
  const { lang, setLang } = useTranslation();
  const [pushEnabled, setPushEnabled] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );

  const handlePushToggle = async () => {
    if (typeof Notification === "undefined") {
      addToast("Notifications non supportées sur ce navigateur.", "warning"); return;
    }
    if (Notification.permission === "granted") {
      addToast("Notifications déjà activées.", "info"); return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setPushEnabled(true);
      addToast("🔔 Notifications activées !", "success");
    } else {
      addToast("Notifications refusées. Autorisez-les dans les paramètres du navigateur.", "warning");
    }
  };

  const Section = ({ title, children }) => (
    <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 1 }}>
        {title}
      </div>
      <div style={{ padding: "4px 0" }}>{children}</div>
    </div>
  );

  const Row = ({ icon, label, desc, right }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 20, width: 32, textAlign: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{right}</div>
    </div>
  );

  const Toggle = ({ value, onToggle }) => (
    <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
      <div style={{ width: 44, height: 24, borderRadius: 12, background: value ? "#2E7D32" : "var(--border)", position: "relative", transition: "background 0.2s" }}>
        <div style={{ position: "absolute", top: 3, left: value ? 22 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
      </div>
    </button>
  );

  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>
        Paramètres
      </h2>
      <p style={{ color: "var(--text-sub)", fontSize: 12, marginBottom: 24 }}>Personnalisez votre expérience SplitLy</p>

      <Section title="🌐 Langue">
        <div style={{ padding: "14px 20px", position: "relative", zIndex: 100 }}>
          <LanguageMenu lang={lang} setLang={setLang} dark={dark} dropUp={false} />
        </div>
      </Section>

      <Section title="🎨 Apparence">
        <Row icon={dark ? "🌙" : "☀️"} label={dark ? "Mode sombre" : "Mode clair"} desc="Changer l'apparence de l'interface"
          right={<Toggle value={dark} onToggle={toggle} />} />
      </Section>

      <Section title="🔔 Notifications">
        <Row icon="🔔" label="Notifications push" desc="Recevoir des alertes en temps réel dans le navigateur"
          right={<Toggle value={pushEnabled} onToggle={handlePushToggle} />} />
      </Section>

      <Section title="👤 Compte">
        <Row icon="📧" label="Email" desc={user?.email} right={null} />
        <Row icon="🏷️" label="Nom" desc={user?.user_metadata?.full_name || "Non défini"} right={null} />
        <Row icon="🔑" label="Rôle" desc="Administrateur" right={null} />
      </Section>

      <Section title="⚠️ Zone de danger">
        <Row icon="🚪" label="Se déconnecter" desc="Fermer votre session sur cet appareil"
          right={
            <button onClick={onSignOut} style={{ padding: "7px 16px", borderRadius: 9, border: "1.5px solid var(--border)", background: "var(--card-bg)", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
              Déconnexion
            </button>
          }
        />
      </Section>

      <div style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: "var(--text-sub)" }}>
        SplitLy · splitmeapp.com · v2.0
      </div>
    </div>
  );
}

// ─── ONBOARDING WIZARD ────────────────────────────────────────
const ONBOARDING_KEY = "splitly_onboarded";

function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      icon: "🎊",
      title: "Bienvenue sur SplitLy !",
      desc: "Gérez vos dépenses partagées en quelques clics. Voyages, restos, colocations — plus de calculs à la main.",
      cta: "Commencer →",
    },
    {
      icon: "👥",
      title: "Créez un événement",
      desc: "Donnez un nom à votre sortie, ajoutez vos amis et choisissez une devise. C'est tout pour commencer.",
      cta: "Compris →",
    },
    {
      icon: "💸",
      title: "Enregistrez les dépenses",
      desc: "Ajoutez chaque dépense, qui a payé et qui est concerné. SplitLy calcule automatiquement qui doit quoi.",
      cta: "C'est parti !",
    },
  ];

  const current = steps[step];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}>
      <div style={{ background: "var(--bg-secondary)", borderRadius: 24, padding: 40, maxWidth: 420, width: "100%", textAlign: "center", boxShadow: "0 32px 80px rgba(0,0,0,0.4)" }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>{current.icon}</div>
        <div style={{ fontSize: 22, fontFamily: "'Playfair Display', serif", fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>
          {current.title}
        </div>
        <div style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 32 }}>
          {current.desc}
        </div>
        {/* Indicateur d'étapes */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 28 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ width: i === step ? 24 : 8, height: 8, borderRadius: 4, background: i === step ? "#0F0F0F" : "var(--border)", transition: "all 0.3s" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              style={{ padding: "12px 20px", borderRadius: 12, border: "1.5px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
              ← Retour
            </button>
          )}
          <button
            onClick={() => {
              if (step < steps.length - 1) {
                setStep(s => s + 1);
              } else {
                try { localStorage.setItem(ONBOARDING_KEY, "true"); } catch {}
                onComplete();
              }
            }}
            style={{ padding: "12px 28px", borderRadius: 12, background: "#0F0F0F", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flex: 1 }}>
            {current.cta}
          </button>
        </div>
        <button onClick={() => { try { localStorage.setItem(ONBOARDING_KEY, "true"); } catch {} onComplete(); }}
          style={{ marginTop: 16, background: "none", border: "none", color: "var(--text-sub)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          Passer l'introduction
        </button>
      </div>
    </div>
  );
}

// ─── SUPER ADMIN ──────────────────────────────────────────────
function SuperAdminPage({ user, isMobile, addToast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null); // { action, userId, userName }
  const [acting, setActing] = useState(null);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");

  const load = async () => {
    setLoading(true);
    const { data, error } = await fetchAdminUsers();
    if (error) { addToast("Erreur chargement : " + error.message, "error"); }
    else setUsers(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAction = async () => {
    if (!confirm) return;
    setActing(confirm.userId);
    const { error } = await adminUserAction(confirm.action, confirm.userId);
    if (error) addToast("Erreur : " + error.message, "error");
    else {
      const labels = { block: "bloqué", unblock: "débloqué", delete: "supprimé" };
      addToast(`✓ Compte ${labels[confirm.action]} avec succès.`, "success");
      await load();
    }
    setActing(null);
    setConfirm(null);
  };

  // Filtres
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.email?.toLowerCase().includes(q) || u.full_name?.toLowerCase().includes(q);
    const matchRole = filterRole === "all" || u.user_role === filterRole;
    return matchSearch && matchRole;
  });

  // KPIs
  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.user_role === 'user').length;
  const blockedUsers = users.filter(u => u.user_role === 'blocked').length;
  const totalBudget = users.reduce((s, u) => s + (u.budget_total || 0), 0);
  const totalEvents = users.reduce((s, u) => s + (u.events_total || 0), 0);

  const roleBadge = (role) => {
    const map = {
      admin:   { label: "Admin",   bg: "#FFF8E1", color: "#F57F17" },
      user:    { label: "Utilisateur", bg: "#E8F5E9", color: "#2E7D32" },
      blocked: { label: "Bloqué",  bg: "#FFEBEE", color: "#C62828" },
    };
    const s = map[role] || map.user;
    return <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20, border: `1px solid ${s.color}22` }}>{s.label}</span>;
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";

  return (
    <div>
      {confirm && (
        <Modal title="Confirmer l'action" onClose={() => setConfirm(null)}>
          <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 16, lineHeight: 1.6 }}>
            {confirm.action === "delete" && (
              <div style={{ background: "#FFEBEE", border: "1px solid #FFCDD2", borderRadius: 10, padding: "12px 16px", marginBottom: 14, fontSize: 13, color: "#C62828" }}>
                ⚠️ Cette action est <strong>irréversible</strong>. Tous les événements et charges de cet utilisateur seront supprimés.
              </div>
            )}
            <span>Action : <strong>{confirm.action === "block" ? "Bloquer" : confirm.action === "unblock" ? "Débloquer" : "Supprimer"}</strong> le compte de <strong>{confirm.userName}</strong></span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleAction} disabled={!!acting}
              style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", background: confirm.action === "delete" ? "#C62828" : confirm.action === "block" ? "#F57F17" : "#2E7D32" }}>
              {acting ? "..." : "Confirmer"}
            </button>
            <button onClick={() => setConfirm(null)} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
          </div>
        </Modal>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 4, color: "var(--text)", display: "flex", alignItems: "center", gap: 10 }}>
            ⚡ Super Admin
            <span style={{ background: "#FFF8E1", color: "#F57F17", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid #FFE08244" }}>Back-office</span>
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>Gestion des comptes utilisateurs SplitLy</p>
        </div>
        <button onClick={load} style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }}>↻ Actualiser</button>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Utilisateurs", value: totalUsers, sub: "inscrits", accent: "#0F0F0F" },
          { label: "Actifs", value: activeUsers, sub: "comptes actifs", accent: "#2E7D32" },
          { label: "Bloqués", value: blockedUsers, sub: "comptes bloqués", accent: "#C62828" },
          { label: "Événements", value: totalEvents, sub: "sur la plateforme", accent: "#1565C0" },
          { label: "Budget plateforme", value: `${(totalBudget / 1000).toFixed(1)}k`, sub: "toutes devises", accent: "#6A1B9A" },
        ].map(k => (
          <div key={k.label} style={{ background: "var(--bg-secondary)", borderRadius: 14, padding: "16px 18px", border: `1px solid var(--border)`, borderLeft: `4px solid ${k.accent}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'Playfair Display', serif", color: "var(--text)" }}>{k.value}</div>
            <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Filtres */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-secondary)", borderRadius: 10, padding: "8px 12px", border: "1px solid var(--border)", flex: 1, minWidth: 180 }}>
          <span style={{ fontSize: 13, opacity: 0.5 }}>🔍</span>
          <input placeholder="Rechercher un utilisateur..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, width: "100%", fontFamily: "inherit" }} />
        </div>
        <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 10, padding: 3, gap: 2 }}>
          {[["all", "Tous"], ["user", "Actifs"], ["blocked", "Bloqués"], ["admin", "Admins"]].map(([val, lbl]) => (
            <button key={val} onClick={() => setFilterRole(val)}
              style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: filterRole === val ? "#0F0F0F" : "transparent", color: filterRole === val ? "#fff" : "var(--text-muted)", fontSize: 12, fontWeight: filterRole === val ? 700 : 400, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Tableau */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}><Spinner fullscreen={false} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="👤" title="Aucun utilisateur" subtitle="Aucun résultat pour ces critères." />
      ) : isMobile ? (
        // Vue mobile — cartes
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(u => (
            <div key={u.id} style={{ background: "var(--bg-secondary)", borderRadius: 14, padding: "14px 16px", border: `1px solid ${u.user_role === "blocked" ? "#FFCDD2" : "var(--border)"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Avatar name={u.full_name !== "—" ? u.full_name : u.email} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.full_name !== "—" ? u.full_name : u.email}</div>
                    <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                  </div>
                </div>
                {roleBadge(u.user_role)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12, fontSize: 11 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{u.events_total}</div>
                  <div style={{ color: "var(--text-sub)" }}>Événements</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{u.expenses_total}</div>
                  <div style={{ color: "var(--text-sub)" }}>Charges</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{fmtDateShort(u.last_sign_in)}</div>
                  <div style={{ color: "var(--text-sub)" }}>Dernière co.</div>
                </div>
              </div>
              {u.user_role !== "admin" && (
                <div style={{ display: "flex", gap: 8 }}>
                  {u.user_role === "blocked" ? (
                    <button onClick={() => setConfirm({ action: "unblock", userId: u.id, userName: u.email })}
                      style={{ flex: 1, padding: "7px", borderRadius: 9, border: "1.5px solid #c8e6c9", background: "#E8F5E9", color: "#2E7D32", fontSize: 12, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                      ✓ Débloquer
                    </button>
                  ) : (
                    <button onClick={() => setConfirm({ action: "block", userId: u.id, userName: u.email })}
                      style={{ flex: 1, padding: "7px", borderRadius: 9, border: "1.5px solid #FFE082", background: "#FFF8E1", color: "#F57F17", fontSize: 12, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                      ⊘ Bloquer
                    </button>
                  )}
                  <button onClick={() => setConfirm({ action: "delete", userId: u.id, userName: u.email })}
                    style={{ flex: 1, padding: "7px", borderRadius: 9, border: "1.5px solid #FFCDD2", background: "#FFEBEE", color: "#C62828", fontSize: 12, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                    🗑 Supprimer
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        // Vue desktop — tableau
        <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr style={{ background: "var(--hover-bg)" }}>
                  {["Utilisateur", "Rôle", "Inscription", "Dernière co.", "Événements", "Charges", "Budget", "Actions"].map(h => (
                    <th key={h} style={{ padding: "12px 16px", fontSize: 10, fontWeight: 700, color: "var(--text-sub)", textAlign: "left", textTransform: "uppercase", letterSpacing: 0.7, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, i) => (
                  <tr key={u.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none", opacity: u.user_role === "blocked" ? 0.65 : 1 }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--hover-bg)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Avatar name={u.full_name !== "—" ? u.full_name : u.email} size={30} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{u.full_name !== "—" ? u.full_name : "—"}</div>
                          <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>{roleBadge(u.user_role)}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{fmtDate(u.created_at)}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{fmtDate(u.last_sign_in)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{u.events_total}</span>
                        {u.events_open > 0 && <span style={{ fontSize: 10, color: "#2E7D32", fontWeight: 600 }}>({u.events_open} ouvert{u.events_open > 1 ? "s" : ""})</span>}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{u.expenses_total}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>
                      {u.budget_total > 0 ? `${(u.budget_total).toFixed(0)}` : "—"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {u.user_role !== "admin" ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          {u.user_role === "blocked" ? (
                            <button onClick={() => setConfirm({ action: "unblock", userId: u.id, userName: u.email })} disabled={acting === u.id}
                              style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #c8e6c9", background: "#E8F5E9", color: "#2E7D32", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                              ✓ Débloquer
                            </button>
                          ) : (
                            <button onClick={() => setConfirm({ action: "block", userId: u.id, userName: u.email })} disabled={acting === u.id}
                              style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #FFE082", background: "#FFF8E1", color: "#F57F17", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                              ⊘ Bloquer
                            </button>
                          )}
                          <button onClick={() => setConfirm({ action: "delete", userId: u.id, userName: u.email })} disabled={acting === u.id}
                            style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #FFCDD2", background: "#FFEBEE", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                            🗑
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--text-sub)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-sub)" }}>
            {filtered.length} utilisateur{filtered.length > 1 ? "s" : ""} affiché{filtered.length > 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────
const S = {
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  input: { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid var(--border)", fontSize: 13, outline: "none", background: "var(--input-bg)", boxSizing: "border-box", color: "var(--text)", transition: "border-color 0.15s", fontFamily: "inherit" },
  btnDark: { background: "var(--btn-dark-bg)", color: "var(--btn-dark-text)", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s" },
  btnGhost: { background: "transparent", color: "var(--text-muted)", border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  card: { background: "var(--card-bg)", borderRadius: 16, padding: 20, border: "1px solid var(--border)", marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: 700, marginBottom: 16, color: "var(--text)" },
};

// ─── THEME CONTEXT ────────────────────────────────────────────
const THEME_KEY = "splitly_theme";
const ThemeContext = createContext({ dark: false, toggle: () => {} });

function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === "dark"; } catch { return false; }
  });

  const toggle = useCallback(() => {
    setDark(d => {
      const next = !d;
      try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch {}
      return next;
    });
  }, []);

  // Injecter les CSS variables selon le thème
  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.style.setProperty("--bg", "#111");
      root.style.setProperty("--bg-secondary", "#1a1a1a");
      root.style.setProperty("--card-bg", "#1e1e1e");
      root.style.setProperty("--border", "#2a2a2a");
      root.style.setProperty("--text", "#f0f0f0");
      root.style.setProperty("--text-muted", "#888");
      root.style.setProperty("--text-sub", "#666");
      root.style.setProperty("--input-bg", "#252525");
      root.style.setProperty("--btn-dark-bg", "#fff");
      root.style.setProperty("--btn-dark-text", "#0F0F0F");
      root.style.setProperty("--hover-bg", "#252525");
      root.style.setProperty("--stat-bg", "#1e1e1e");
      document.body.style.background = "#111";
      document.body.style.color = "#f0f0f0";
    } else {
      root.style.setProperty("--bg", "#f2f2f2");
      root.style.setProperty("--bg-secondary", "#fff");
      root.style.setProperty("--card-bg", "#f9f9f9");
      root.style.setProperty("--border", "#e5e5e5");
      root.style.setProperty("--text", "#1a1a1a");
      root.style.setProperty("--text-muted", "#555");
      root.style.setProperty("--text-sub", "#aaa");
      root.style.setProperty("--input-bg", "#fff");
      root.style.setProperty("--btn-dark-bg", "#0F0F0F");
      root.style.setProperty("--btn-dark-text", "#fff");
      root.style.setProperty("--hover-bg", "#f5f5f5");
      root.style.setProperty("--stat-bg", "#f9f9f9");
      document.body.style.background = "#f2f2f2";
      document.body.style.color = "#1a1a1a";
    }
  }, [dark]);

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      <style>{`
        :root {
          --bg: #f2f2f2; --bg-secondary: #fff; --card-bg: #f9f9f9;
          --border: #e5e5e5; --text: #1a1a1a; --text-muted: #555;
          --text-sub: #aaa; --input-bg: #fff; --btn-dark-bg: #0F0F0F;
          --btn-dark-text: #fff; --hover-bg: #f5f5f5; --stat-bg: #f9f9f9;
        }
        * { box-sizing: border-box; transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease; }
        body { margin: 0; }
      `}</style>
      {children}
    </ThemeContext.Provider>
  );
}

function useTheme() {
  return useContext(ThemeContext);
}

// ─── APP RACINE ───────────────────────────────────────────────
const GUEST_SESSION_KEY = "splitly_guest_email";

function AppInner() {
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [guestEmail, setGuestEmail] = useState(() => {
    try { return localStorage.getItem(GUEST_SESSION_KEY) || null; }
    catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [active, setActiveRaw] = useState("dashboard");
  const [navHistory, setNavHistory] = useState(["dashboard"]);
  const [pageKey, setPageKey] = useState(0);
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contributions, setContributions] = useState({});
  const [history, setHistory] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [pendingActions, setPendingActions] = useState([]);
  const [profile, setProfile] = useState(null);
  const { toasts, addToast, removeToast } = useToast();
  const { t, lang, setLang } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  // Navigation avec historique et animation
  const setActive = useCallback((page) => {
    setActiveRaw(prev => {
      if (prev === page) return prev;
      setNavHistory(h => [...h.slice(-9), page]);
      setPageKey(k => k + 1);
      return page;
    });
  }, []);

  // Bouton retour
  const goBack = useCallback(() => {
    setNavHistory(h => {
      if (h.length < 2) return h;
      const prev = h[h.length - 2];
      setActiveRaw(prev);
      setPageKey(k => k + 1);
      return h.slice(0, -1);
    });
  }, []);

  // Raccourcis clavier G + lettre (comme Notion/Linear)
  const gPressed = useRef(false);
  useEffect(() => {
    const KEYS = { d: "dashboard", e: "events", x: "expenses", b: "balance", a: "analytics", h: "history", i: "invite", n: "notifications" };
    const down = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.key === "g" || e.key === "G") { gPressed.current = true; return; }
      if (gPressed.current && KEYS[e.key.toLowerCase()]) {
        setActive(KEYS[e.key.toLowerCase()]);
        gPressed.current = false;
      }
      // Echap pour fermer la recherche
      if (e.key === "Escape") setSearchQuery("");
    };
    const up = (e) => { if (e.key === "g" || e.key === "G") gPressed.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [setActive]);

  // Labels pour le breadcrumb
  const NAV_LABELS = {
    dashboard: t("nav_dashboard"), events: t("nav_events"),
    expenses: t("nav_expenses"), balance: t("nav_balance"),
    analytics: t("nav_analytics"), history: t("nav_history"),
    invite: t("nav_invite"), notifications: t("nav_notifications"),
  };

  // Sauvegarder la session invité
  const handleGuestAuth = useCallback((email) => {
    try { localStorage.setItem(GUEST_SESSION_KEY, email); } catch {}
    setGuestEmail(email);
    setAuthMode(null);
  }, []);

  // Déconnexion invité
  const handleGuestSignOut = useCallback(() => {
    try { localStorage.removeItem(GUEST_SESSION_KEY); } catch {}
    setGuestEmail(null);
  }, []);

  useEffect(() => {
    getSession().then(async s => {
      const u = s?.user || null;
      setUser(u);
      setLoading(false);
      if (u) {
        try {
          const onboarded = localStorage.getItem(ONBOARDING_KEY);
          if (!onboarded) setShowOnboarding(true);
        } catch {}
        // Charger le profil (silencieux si erreur RLS)
        try {
          const { data: prof } = await fetchProfile(u.id);
          setProfile(prof || null);
        } catch {}
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadAll = useCallback(async () => {
    if (!user) return;
    const { data: evData } = await fetchEvents(user.id);
    if (!evData) return;
    setEvents(evData);
    const allExp = [], allContrib = {}, allHist = [];
    for (const ev of evData) {
      const { data: exData } = await fetchExpenses(ev.id);
      if (exData) allExp.push(...exData);
      const { data: cData } = await fetchContributions(ev.id);
      if (cData) { allContrib[ev.id] = cData; }
      const { data: hData } = await fetchHistory(ev.id);
      if (hData) allHist.push(...hData);
    }
    setExpenses(allExp); setContributions(allContrib); setHistory(allHist);
    const { data: nData } = await fetchNotifications(user.id);
    if (nData) setNotifications(nData);
    if (evData.length > 0) {
      const { data: paData } = await fetchAllPendingActions(evData.map(e => e.id));
      if (paData) setPendingActions(paData);
    }
  }, [user]);

  useEffect(() => { if (user) loadAll(); }, [user, loadAll]);

  // ─── Notifications Realtime ───────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const ch = subscribeToNotifications(user.id, () => {
      fetchNotifications(user.id).then(({ data }) => { if (data) setNotifications(data); });
    });
    return () => unsubscribe(ch);
  }, [user]);

  // ─── Charges & Contributions Realtime ────────────────────────
  useEffect(() => {
    if (!user || events.length === 0) return;
    const eventIds = events.map(e => e.id);

    // S'abonner aux changements des charges
    const expCh = supabase
      .channel("expenses-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, (payload) => {
        // Recharger seulement si la charge appartient à un de nos événements
        const evId = payload.new?.event_id || payload.old?.event_id;
        if (evId && eventIds.includes(evId)) {
          loadAll();
        }
      })
      .subscribe();

    // S'abonner aux changements des contributions
    const contCh = supabase
      .channel("contributions-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "contributions" }, (payload) => {
        const evId = payload.new?.event_id || payload.old?.event_id;
        if (evId && eventIds.includes(evId)) {
          loadAll();
        }
      })
      .subscribe();

    // S'abonner aux pending actions
    const pendingCh = supabase
      .channel("pending-actions-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pending_actions" }, () => {
        loadAll();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(expCh);
      supabase.removeChannel(contCh);
      supabase.removeChannel(pendingCh);
    };
  }, [user, events.length]);

  const handleSignOut = async () => {
    await signOut();
    setUser(null); setGuestEmail(null); setEvents([]); setExpenses([]);
    setContributions({}); setHistory([]); setNotifications([]); setPendingActions([]);
  };

  if (loading) return <Spinner />;

  // Afficher la landing page si pas connecté et pas invité
  if (!user && !guestEmail) {
    return (
      <>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <ToastContainer toasts={toasts} removeToast={removeToast} />
        {authMode ? (
          <AuthScreen
            initialMode={authMode}
            onAuth={(u) => { setAuthMode(null); setUser(u); }}
            onGuestAuth={handleGuestAuth}
            onClose={() => setAuthMode(null)}
          />
        ) : (
          <LandingPage
            onSignUp={() => setAuthMode("register")}
            onSignIn={() => setAuthMode("login")}
            onGuest={() => setAuthMode("guest")}
          />
        )}
      </>
    );
  }

  if (guestEmail) return <GuestView guestEmail={guestEmail} onSignOut={handleGuestSignOut} isMobile={isMobile} addToast={addToast} t={t} />;

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const pendingCount = pendingActions.length;

  // Normaliser contributions
  const contribNorm = {};
  Object.entries(contributions).forEach(([evId, arr]) => {
    contribNorm[evId] = Array.isArray(arr) ? arr : [];
  });

  const sharedProps = { events, expenses, contributions: contribNorm, user, reload: loadAll, isMobile, addToast, t };

  // Résultats de recherche globale
  const showSearch = searchQuery.trim().length > 1;
  const q = searchQuery.toLowerCase();
  const searchResults = showSearch ? {
    events: events.filter(e => e.name.toLowerCase().includes(q)),
    expenses: expenses.filter(e => e.detail?.toLowerCase().includes(q) || e.paid_by?.toLowerCase().includes(q) || e.category?.toLowerCase().includes(q)),
    participants: [...new Set(events.flatMap(e => (e.event_participants || []).map(p => p.name)))].filter(p => p.toLowerCase().includes(q)),
  } : null;

  const isAdmin = profile?.user_role === "admin";

  const pages = {
    dashboard:     <Dashboard {...sharedProps} navigateTo={setActive} />,
    events:        <Events {...sharedProps} />,
    expenses:      <Expenses {...sharedProps} />,
    balance:       <Balance {...sharedProps} />,
    analytics:     <Analytics {...sharedProps} />,
    history:       <History events={events} history={history} user={user} reload={loadAll} isMobile={isMobile} addToast={addToast} t={t} />,
    invite:        <Invite events={events} user={user} isMobile={isMobile} addToast={addToast} t={t} />,
    notifications: <NotificationsPage notifications={notifications} events={events} expenses={expenses}
                     pendingActions={pendingActions} user={user} reload={loadAll} isMobile={isMobile} addToast={addToast} t={t}
                     onMarkAll={async () => { await markAllNotificationsRead(user.id); await loadAll(); addToast(t("notif_mark_all"), "info"); }}
                     onDismiss={async (id) => { await deleteNotification(id); await loadAll(); }} />,
    settings:      <SettingsPage user={user} onSignOut={handleSignOut} isMobile={isMobile} addToast={addToast} />,
    ...(isAdmin ? { superadmin: <SuperAdminPage user={user} isMobile={isMobile} addToast={addToast} /> } : {}),
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", maxWidth: "100vw", background: "var(--bg)", fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { overflow-x: hidden; max-width: 100vw; margin:0; padding:0; }
        table { table-layout: fixed; }
        @keyframes pageFadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .page-transition { animation: pageFadeIn 0.15s ease; pointer-events: auto; }
        .kbd-hint { display:inline-flex;align-items:center;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;padding:1px 6px;font-size:10px;font-family:monospace;color:#666; }
      `}</style>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      <Sidebar active={active} setActive={setActive} unreadCount={unreadCount} pendingCount={pendingCount}
        user={user} onSignOut={handleSignOut} isMobile={isMobile} menuOpen={menuOpen} setMenuOpen={setMenuOpen}
        t={t} lang={lang} setLang={setLang} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        isAdmin={isAdmin} />

      <main style={{ flex: 1, overflow: "hidden", minWidth: 0, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
        {/* Topbar desktop — breadcrumb léger */}
        {!isMobile && (
          <div style={{ padding: "10px 32px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, background: "var(--bg)", flexShrink: 0 }}>
            {navHistory.length > 1 && (
              <button onClick={goBack} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 7, padding: "3px 10px", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, fontFamily: "inherit" }}>
                ←
              </button>
            )}
            <span style={{ fontSize: 12, color: "var(--text-sub)" }}>SplitLy</span>
            <span style={{ color: "var(--border)", fontSize: 12 }}>/</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{NAV_LABELS[active]}</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-sub)", opacity: 0.4 }}>G + lettre</span>
          </div>
        )}

        {/* Contenu scrollable */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: isMobile ? "72px 16px 80px" : "28px 32px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%" }}>
            <div key={pageKey} className="page-transition">
          {showSearch ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
                  Résultats pour "{searchQuery}"
                </h2>
                <button onClick={() => setSearchQuery("")} style={{ ...S.btnGhost, fontSize: 12 }}>× Effacer</button>
              </div>

              {/* Événements trouvés */}
              {searchResults.events.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Événements ({searchResults.events.length})</div>
                  {searchResults.events.map(ev => (
                    <div key={ev.id} onClick={() => { setActive("events"); setSearchQuery(""); }} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #eee", marginBottom: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 20 }}>{ev.status === "closed" ? "🔒" : "🎊"}</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{ev.name}</div>
                        <div style={{ fontSize: 12, color: "#aaa" }}>{ev.date} · {(ev.event_participants || []).length} participants</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Charges trouvées */}
              {searchResults.expenses.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Charges ({searchResults.expenses.length})</div>
                  {searchResults.expenses.slice(0, 8).map(ex => {
                    const ev = events.find(e => e.id === ex.event_id);
                    const cat = CATEGORIES[ex.category];
                    const total = ex.qty * (ex.unit_price ?? 0);
                    return (
                      <div key={ex.id} onClick={() => { setActive("expenses"); setSearchQuery(""); }} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #eee", marginBottom: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 20 }}>{cat?.icon || "🧾"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail}</div>
                          <div style={{ fontSize: 12, color: "#aaa" }}>{ev?.name} · par {ex.paid_by}</div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(total, currencySymbol(ev?.currency))}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Participants trouvés */}
              {searchResults.participants.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Participants ({searchResults.participants.length})</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {searchResults.participants.map(p => (
                      <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", borderRadius: 20, padding: "8px 16px", border: "1px solid #eee" }}>
                        <Avatar name={p} size={24} />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{p}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Aucun résultat */}
              {searchResults.events.length === 0 && searchResults.expenses.length === 0 && searchResults.participants.length === 0 && (
                <EmptyState icon="🔍" title="Aucun résultat" subtitle={`Aucun élément ne correspond à "${searchQuery}".`} />
              )}
            </div>
          ) : (
            pages[active]
          )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
