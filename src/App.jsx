import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import LandingPage from "./LandingPage.jsx";
import { useTranslation, LanguageSwitcher, LanguageMenu } from "./i18n.jsx";
import {
  supabase, signUp, signIn, signOut, getSession,
  fetchEvents, createEvent, updateEventStatus, updateEvent, deleteEvent,
  addParticipant, removeParticipant,
  fetchExpenses, createExpense, updateExpense, deleteExpense,
  fetchContributions, upsertContribution, recordPayment, fetchPayments,
  fetchHistory, invalidateHistory,
  fetchNotifications, markAllNotificationsRead, deleteNotification,
  fetchInvitations, sendInvitation, removeInvitation, updateInvitationRole,
  updateInvitationPermissions, fetchInvitationPermissions, requestPermissions,
  submitPendingAction, fetchAllPendingActions, approvePendingAction, rejectPendingAction,
  sendGuestCode, verifyGuestCode,
  subscribeToNotifications, unsubscribe,
  exportPDF,
  fetchProfile, fetchAdminUsers, adminUserAction,
  fetchCotisations, createCotisation, updateCotisation, deleteCotisation,
  fetchAvances, createAvance, updateAvance, deleteAvance,
  createReport, fetchReports,
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
  const [cotisations, setCotisations] = useState({}); // { eventId: [cotisations] }
  const [active, setActive] = useState("events");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permissionsMap, setPermissionsMap] = useState({});
  const [showRequestPerms, setShowRequestPerms] = useState(false);
  const [requestEventId, setRequestEventId] = useState("");
  const [requestedPerms, setRequestedPerms] = useState([]);
  const [requestSaving, setRequestSaving] = useState(false);

  // Filtre par événement (partagé entre onglets)
  const [filterEventId, setFilterEventId] = useState("");

  // Formulaires charges
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);

  const loadGuest = useCallback(async () => {
    setLoading(true);
    const { data: invitations } = await supabase
      .from('invitations')
      .select('event_id, role, status, permissions')
      .eq('email', guestEmail);
    if (!invitations || invitations.length === 0) { setLoading(false); return; }

    const pMap = {};
    invitations.forEach(i => { pMap[i.event_id] = i.permissions || []; });
    setPermissionsMap(pMap);

    const eventIds = invitations.map(i => i.event_id);
    const { data: evData } = await supabase.from('events').select('*, event_participants(name)').in('id', eventIds);
    if (!evData) { setLoading(false); return; }
    setEvents(evData);
    if (evData.length > 0) setFilterEventId(evData[0].id);

    const allExp = [], allContrib = {}, allCot = {};
    for (const ev of evData) {
      const { data: exData } = await supabase.from('expenses').select('*').eq('event_id', ev.id);
      if (exData) allExp.push(...exData);
      const { data: cData } = await supabase.from('contributions').select('*').eq('event_id', ev.id);
      if (cData) { allContrib[ev.id] = {}; cData.forEach(c => { allContrib[ev.id][c.participant] = c.amount; }); }
      if (ev.event_type === "budget") {
        const { data: cotData } = await supabase.from('cotisations').select('*').eq('event_id', ev.id);
        if (cotData) allCot[ev.id] = cotData;
      }
    }
    setExpenses(allExp); setContributions(allContrib); setCotisations(allCot);
    setLoading(false);
  }, [guestEmail]);

  useEffect(() => { loadGuest(); }, [loadGuest]);

  const can = (eventId, perm) => normalizePerms(permissionsMap[eventId] || []).includes(perm);

  const submitAction = async (actionType, actionData, eventId) => {
    setSaving(true);
    await submitPendingAction({ eventId, guestEmail, actionType, actionData });
    setSaving(false);
    setShowAddExpense(false);
    setEditingExpense(null);
    addToast("Demande envoyée à l'admin.", "info");
    await loadGuest();
  };

  const handleRequestPerms = async () => {
    if (!requestEventId || requestedPerms.length === 0) return;
    setRequestSaving(true);
    await requestPermissions(requestEventId, guestEmail, requestedPerms);
    setRequestSaving(false);
    setShowRequestPerms(false);
    setRequestedPerms([]);
    addToast("Demande de droits envoyée à l'admin.", "success");
  };

  if (loading) return <Spinner />;

  const selectedEv = events.find(e => e.id === filterEventId);
  const isBudget = selectedEv?.event_type === "budget";
  const sym = currencySymbol(selectedEv?.currency);
  const evParticipants = (selectedEv?.event_participants || []).map(p => p.name);
  const evExpenses = expenses.filter(e => e.event_id === filterEventId);
  const evContribs = contributions[filterEventId] || {};
  const evCotisations = cotisations[filterEventId] || [];

  // Navigation : même modèle que l'admin
  const navItems = [
    { key: "events",       icon: "◉", label: "Événements" },
    { key: "expenses",     icon: "◫", label: "Charges" },
    { key: "contributions",icon: "⊜", label: "Contributions" },
  ];

  // Sélecteur événement commun (réutilisé dans chaque onglet)
  const EventSelector = () => (
    <select style={{ ...S.input, width: "auto", fontSize: 12, marginBottom: 16 }}
      value={filterEventId} onChange={e => setFilterEventId(e.target.value)}>
      {events.map(ev => <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}</option>)}
    </select>
  );

  // Badge droits de l'invité sur l'événement sélectionné
  const MyPermsBadge = ({ eventId }) => {
    const perms = normalizePerms(permissionsMap[eventId] || []);
    if (perms.length === 0) return <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 20, background: "#f5f5f5", color: "#888", fontWeight: 600 }}>👁 Lecture seule</span>;
    return <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{perms.map(p => { const info = ALL_PERMISSIONS[p]; return info ? <span key={p} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: info.bg, color: info.color, fontWeight: 700 }}>{info.icon} {info.label}</span> : null; })}</div>;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--bg, #f4f4f4)" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "#0F0F0F", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: "#fff" }}>SplitLy</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ background: "#1565C0", color: "#fff", fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>👤 Invité</span>
          {!isMobile && <span style={{ color: "#666", fontSize: 11 }}>{guestEmail}</span>}
          <button onClick={() => setShowRequestPerms(true)}
            style={{ background: "#FFF8E1", border: "1px solid #FFE082", color: "#F57F17", fontSize: 10, padding: "4px 8px", borderRadius: 7, cursor: "pointer", fontWeight: 600 }}>
            🔐 Droits
          </button>
          <button onClick={onSignOut}
            style={{ background: "none", border: "1px solid #333", color: "#aaa", fontSize: 10, padding: "4px 10px", borderRadius: 7, cursor: "pointer" }}>
            Quitter
          </button>
        </div>
      </div>

      {/* Navigation horizontale */}
      <div style={{ background: "#fff", borderBottom: "1px solid #eee", display: "flex", position: "sticky", top: 52, zIndex: 99 }}>
        {navItems.map(n => (
          <button key={n.key} onClick={() => setActive(n.key)}
            style={{ flex: 1, padding: "12px 4px", border: "none", background: "none", fontSize: 12, fontWeight: active === n.key ? 700 : 400, color: active === n.key ? "#0F0F0F" : "#888", cursor: "pointer", borderBottom: active === n.key ? "2px solid #0F0F0F" : "2px solid transparent", transition: "all 0.15s", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 15 }}>{n.icon}</span>
            <span style={{ fontSize: 10 }}>{n.label}</span>
          </button>
        ))}
      </div>

      {/* Modal demande de droits */}
      {showRequestPerms && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>🔐 Demander des droits</div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>L'admin sera notifié et pourra accepter ou refuser.</div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Événement</label>
              <select style={S.input} value={requestEventId} onChange={e => { setRequestEventId(e.target.value); setRequestedPerms([]); }}>
                <option value="">Sélectionner...</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}</option>)}
              </select>
            </div>
            {requestEventId && (() => {
              const ev = events.find(e => e.id === requestEventId);
              const myPerms = normalizePerms(permissionsMap[requestEventId] || []);
              const available = getAvailablePermissions(ev?.event_type || "split").filter(p => !myPerms.includes(p.key));
              return (
                <div style={{ marginBottom: 16 }}>
                  <label style={S.label}>Droits demandés</label>
                  {available.length === 0
                    ? <div style={{ fontSize: 13, color: "#2E7D32", background: "#E8F5E9", borderRadius: 8, padding: "10px 14px" }}>✓ Vous avez déjà tous les droits disponibles.</div>
                    : available.map(p => (
                      <label key={p.key} onClick={() => setRequestedPerms(prev => prev.includes(p.key) ? prev.filter(x => x !== p.key) : [...prev, p.key])}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, border: `1.5px solid ${requestedPerms.includes(p.key) ? p.color : "#e0e0e0"}`, background: requestedPerms.includes(p.key) ? p.bg : "#fafafa", cursor: "pointer", marginBottom: 6, transition: "all 0.15s" }}>
                        <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${requestedPerms.includes(p.key) ? p.color : "#ccc"}`, background: requestedPerms.includes(p.key) ? p.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {requestedPerms.includes(p.key) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                        </div>
                        <span>{p.icon}</span>
                        <div><div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div><div style={{ fontSize: 11, color: "#888" }}>{p.desc}</div></div>
                      </label>
                    ))
                  }
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleRequestPerms} disabled={requestSaving || !requestEventId || requestedPerms.length === 0}
                style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", opacity: (!requestEventId || requestedPerms.length === 0) ? 0.5 : 1 }}>
                {requestSaving ? "..." : "Envoyer la demande"}
              </button>
              <button onClick={() => { setShowRequestPerms(false); setRequestedPerms([]); }} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* Contenu principal */}
      <main style={{ flex: 1, padding: isMobile ? "16px 14px 80px" : "24px 28px", maxWidth: 860, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>

        {/* ── Bandeau droits sur l'événement sélectionné ── */}
        {filterEventId && active !== "events" && (
          <div style={{ background: "#f5f5f5", borderRadius: 10, padding: "8px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#888" }}>Vos droits sur <strong>{selectedEv?.name}</strong> :</span>
            <MyPermsBadge eventId={filterEventId} />
            <button onClick={() => setShowRequestPerms(true)}
              style={{ fontSize: 10, color: "#F57F17", background: "none", border: "none", cursor: "pointer", fontWeight: 700, fontFamily: "inherit", marginLeft: "auto" }}>
              + Demander plus
            </button>
          </div>
        )}

        {/* ─── ONGLET ÉVÉNEMENTS ─── */}
        {active === "events" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "var(--text, #0F0F0F)" }}>Événements partagés</h2>
            </div>
            {events.length === 0 ? (
              <EmptyState icon="🎊" title="Aucun événement" subtitle="Aucun événement n'a encore été partagé avec vous." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {events.map(ev => {
                  const participants = (ev.event_participants || []).map(p => p.name);
                  const evTotal = expenses.filter(e => e.event_id === ev.id).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
                  const myPerms = normalizePerms(permissionsMap[ev.id] || []);
                  return (
                    <div key={ev.id} style={{ background: "#fff", borderRadius: 14, padding: "14px 18px", border: `1px solid ${ev.event_type === "budget" ? "#FFE082" : "#eee"}` }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ fontSize: 24, flexShrink: 0 }}>{ev.status === "closed" ? "🔒" : ev.event_type === "budget" ? "🏦" : "🎊"}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</span>
                            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: ev.event_type === "budget" ? "#FFF8E1" : "#F3E5F5", color: ev.event_type === "budget" ? "#F57F17" : "#6A1B9A", fontWeight: 700 }}>
                              {ev.event_type === "budget" ? "🏦 Budget" : "💸 Split"}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "#888", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ev.date} · {currencySymbol(ev.currency)} · {participants.length} participants
                          </div>
                          <AvatarStack names={participants} size={22} />
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{fmt(evTotal, currencySymbol(ev.currency))}</div>
                          <div style={{ fontSize: 10, color: "#aaa" }}>{ev.event_type === "budget" ? "dépenses" : "budget"}</div>
                          {/* PDF si droits */}
                          {can(ev.id, "export_pdf") && ev.event_type !== "budget" && (
                            <button onClick={() => {
                              const evExp = expenses.filter(e => e.event_id === ev.id);
                              const contribMap = contributions[ev.id] || {};
                              exportPDF(ev, evExp, contribMap, participants);
                            }} style={{ marginTop: 8, padding: "4px 10px", borderRadius: 8, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                              📄 PDF
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Droits sur cet événement */}
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 10, color: "#aaa" }}>Vos droits :</span>
                        {myPerms.length === 0
                          ? <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#f5f5f5", color: "#888", fontWeight: 600 }}>👁 Lecture seule</span>
                          : myPerms.map(p => { const info = ALL_PERMISSIONS[p]; return info ? <span key={p} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: info.bg, color: info.color, fontWeight: 700 }}>{info.icon} {info.label}</span> : null; })
                        }
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── ONGLET CHARGES ─── */}
        {active === "expenses" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "var(--text, #0F0F0F)" }}>Charges</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <EventSelector />
                {/* Ajouter charge — selon droits */}
                {can(filterEventId, "add_expense") && selectedEv?.status === "open" && (
                  <button onClick={() => setShowAddExpense(!showAddExpense)} style={S.btnDark}>
                    {showAddExpense ? "× Fermer" : "➕ Ajouter"}
                  </button>
                )}
              </div>
            </div>

            {showAddExpense && can(filterEventId, "add_expense") && (
              <GuestExpenseForm
                events={events.filter(e => e.id === filterEventId)}
                onSubmit={submitAction}
                onCancel={() => setShowAddExpense(false)}
                saving={saving}
                isBudget={isBudget}
              />
            )}

            {editingExpense && can(filterEventId, "edit_expense") && (
              <GuestEditExpenseForm
                expense={editingExpense}
                events={events}
                onSubmit={async (data) => { await submitAction("modify_expense", { ...data, expense_id: editingExpense.id }, editingExpense.event_id); }}
                onCancel={() => setEditingExpense(null)}
                saving={saving}
              />
            )}

            {evExpenses.length === 0 ? (
              <EmptyState icon="🧾" title="Aucune charge" subtitle={`Aucune dépense sur "${selectedEv?.name}".`} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {evExpenses.map(ex => {
                  const cat = CATEGORIES[ex.category];
                  const total = ex.qty * (ex.unit_price ?? 0);
                  return (
                    <div key={ex.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #eee" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <span style={{ fontSize: 20, flexShrink: 0 }}>{cat?.icon}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail}</div>
                            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                              {ex.is_unpaid ? <span style={{ color: "#F57F17", fontWeight: 600 }}>⏳ Non réglée</span> : `par ${ex.paid_by}`}
                            </div>
                            {ex.comment && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic", marginTop: 2 }}>💬 {ex.comment}</div>}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700 }}>{fmt(total, sym)}</div>
                          {/* Modifier — selon droits */}
                          {can(filterEventId, "edit_expense") && selectedEv?.status === "open" && (
                            <button onClick={() => setEditingExpense(ex)}
                              style={{ marginTop: 6, padding: "3px 10px", borderRadius: 8, border: "1.5px solid #FFE082", background: "#FFF8E1", color: "#F57F17", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                              ✏️ Modifier
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

        {/* ─── ONGLET CONTRIBUTIONS ─── */}
        {active === "contributions" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "var(--text, #0F0F0F)" }}>
                {isBudget ? "💰 Cotisations" : "⊜ Répartition"}
              </h2>
              <EventSelector />
            </div>

            {/* Budget → Cotisations */}
            {isBudget ? (
              <div>
                {/* Ajouter cotisation — selon droits */}
                {can(filterEventId, "add_cotisation") && selectedEv?.status === "open" && (
                  <div style={{ marginBottom: 14 }}>
                    <GuestCotisationForm
                      ev={selectedEv}
                      onSubmit={(data) => submitAction("add_cotisation", data, filterEventId)}
                      saving={saving}
                    />
                  </div>
                )}

                {evCotisations.length === 0 ? (
                  <EmptyState icon="💰" title="Aucune cotisation" subtitle="Aucune cotisation enregistrée pour cet événement." />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {evCotisations.map(cot => (
                      <div key={cot.id} style={{ background: "#fff", borderRadius: 12, padding: "12px 16px", border: "1px solid #eee", display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cot.participant_name}</div>
                          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                            <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: cot.forme === "nature" ? "#E8F5E9" : "#E3F2FD", color: cot.forme === "nature" ? "#2E7D32" : "#1565C0", fontWeight: 700 }}>
                              {cot.forme === "nature" ? "🌿 Nature" : "💵 Espèces"}
                            </span>
                            <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: cot.statut === "paye" ? "#E8F5E9" : "#FFEBEE", color: cot.statut === "paye" ? "#2E7D32" : "#C62828", fontWeight: 700 }}>
                              {cot.statut === "paye" ? "✓ Payé" : "✗ Impayé"}
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#0F0F0F", flexShrink: 0 }}>{fmt(cot.montant, sym)}</div>
                      </div>
                    ))}
                    {/* Bilan rapide */}
                    <div style={{ background: "#f5f5f5", borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                      <span style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>Total collecté</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#2E7D32" }}>{fmt(evCotisations.filter(c => c.statut === "paye").reduce((s, c) => s + c.montant, 0), sym)}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Split → Répartition */
              <GuestBalanceSection ev={selectedEv} evExp={evExpenses} evContribMap={evContribs} sym={sym} />
            )}
          </div>
        )}

      </main>
    </div>
  );
}

  const loadGuest = useCallback(async () => {
    setLoading(true);
    const { data: invitations } = await supabase
      .from('invitations')
      .select('event_id, role, status, permissions')
      .eq('email', guestEmail);
    if (!invitations || invitations.length === 0) { setLoading(false); return; }

    // Build permissions map
    const pMap = {};
    invitations.forEach(i => { pMap[i.event_id] = i.permissions || ["read_only"]; });
    setPermissionsMap(pMap);

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

function GuestExpenseForm({ events, onSubmit, onCancel, saving, isBudget }) {
  const empty = { eventId: events[0]?.id || "", category: "", sub: "", detail: "", qty: 1, unit: "", paidBy: "", included: [] };
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
        <div><label style={S.label}>{isBudget ? "Responsable" : "Payé par"}</label>
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
      {currentEvent && !isBudget && <div style={{ marginBottom: 14 }}><ParticipantToggle people={participants} selected={form.included} onChange={p => setForm({ ...form, included: p })} label="Qui partage ?" /></div>}
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

// Formulaire cotisation invité (soumis à approbation)
function GuestCotisationForm({ ev, onSubmit, saving }) {
  const sym = currencySymbol(ev?.currency);
  const cible = ev?.cotisation_cible || 0;
  const [form, setForm] = useState({ participant_name: "", montant: "", forme: "especes", description: "" });
  const [montantMode, setMontantMode] = useState(cible > 0 ? "minimal" : "libre");

  const getMontant = () => montantMode === "minimal" ? cible : Number(form.montant) || 0;

  return (
    <div style={{ background: "#E3F2FD", border: "1.5px solid #1565C0", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1565C0", marginBottom: 12 }}>💰 Soumettre une cotisation</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={S.label}>Nom participant</label>
          <input style={S.input} placeholder="Prénom" value={form.participant_name} onChange={e => setForm({ ...form, participant_name: e.target.value })} maxLength={30} />
        </div>
        <div>
          <label style={S.label}>Montant ({sym})</label>
          {cible > 0 ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setMontantMode("minimal")} style={{ flex: 1, padding: "6px 4px", borderRadius: 7, border: `1.5px solid ${montantMode === "minimal" ? "#2E7D32" : "#ddd"}`, background: montantMode === "minimal" ? "#E8F5E9" : "#fff", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                {fmt(cible, sym)}
              </button>
              <button onClick={() => setMontantMode("libre")} style={{ flex: 1, padding: "6px 4px", borderRadius: 7, border: `1.5px solid ${montantMode === "libre" ? "#1565C0" : "#ddd"}`, background: montantMode === "libre" ? "#E3F2FD" : "#fff", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                Autre
              </button>
            </div>
          ) : (
            <input type="number" min="0.01" step="0.01" style={S.input} placeholder="Ex: 50" value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} />
          )}
          {montantMode === "libre" && cible > 0 && (
            <input type="number" min={cible} step="0.01" style={{ ...S.input, marginTop: 6 }} placeholder={`Min. ${fmt(cible, sym)}`} value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} />
          )}
        </div>
        <div>
          <label style={S.label}>Forme</label>
          <select style={S.input} value={form.forme} onChange={e => setForm({ ...form, forme: e.target.value })}>
            <option value="especes">💵 Espèces</option>
            <option value="nature">🌿 En nature</option>
          </select>
        </div>
        <div>
          <label style={S.label}>Description (opt.)</label>
          <input style={S.input} placeholder="Ex: Virement 15/05" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
      </div>
      <button onClick={() => onSubmit({ ...form, montant: getMontant(), statut: getMontant() > 0 ? "paye" : "impaye", event_id: ev.id })}
        disabled={saving || !form.participant_name.trim() || getMontant() <= 0}
        style={{ ...S.btnDark, opacity: (!form.participant_name.trim() || getMontant() <= 0) ? 0.5 : 1, fontSize: 12 }}>
        {saving ? "Envoi..." : "Soumettre la cotisation"}
      </button>
      <div style={{ fontSize: 11, color: "#1565C0", marginTop: 8 }}>ℹ️ Votre demande sera soumise à l'approbation de l'admin.</div>
    </div>
  );
}

// Section répartition (vue invité — Split)
function GuestBalanceSection({ ev, evExp, evContribMap, sym }) {
  const participants = (ev?.event_participants || []).map(p => p.name);
  if (!ev || participants.length === 0) return <EmptyState icon="👥" title="Aucun participant" subtitle="Aucune donnée disponible." />;

  const transactions = computeTransactions(evExp, evContribMap, participants);

  return (
    <div>
      {/* Soldes */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0F0F", marginBottom: 10 }}>Soldes par participant</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {participants.map(p => {
            const net = computeNetBalance(evExp, evContribMap, p);
            const settled = isSettled(net);
            return (
              <div key={p} style={{ background: "#fff", borderRadius: 10, padding: "10px 14px", border: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar name={p} size={28} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{p}</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: settled ? "#2E7D32" : net > 0 ? "#1565C0" : "#C62828" }}>
                  {settled ? "✓ Soldé" : net > 0 ? `+${fmt(net, sym)}` : fmt(net, sym)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {/* Remboursements */}
      {transactions.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0F0F", marginBottom: 10 }}>Remboursements à effectuer</div>
          {transactions.map((tx, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 10, padding: "10px 14px", border: "1px solid #eee", display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <Avatar name={tx.from} size={24} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{tx.from}</span>
              <span style={{ fontSize: 12, color: "#888" }}>→</span>
              <Avatar name={tx.to} size={24} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{tx.to}</span>
              <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 700, color: "#C62828" }}>{fmt(tx.amount, sym)}</span>
            </div>
          ))}
        </div>
      )}
      {transactions.length === 0 && (
        <div style={{ background: "#E8F5E9", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#2E7D32", fontWeight: 600 }}>
          ✓ Aucun remboursement nécessaire — tout est soldé
        </div>
      )}
    </div>
  );
}


// ─── SIDEBAR ──────────────────────────────────────────────────
function Sidebar({ active, setActive, unreadCount, pendingCount, user, onSignOut, isMobile, menuOpen, setMenuOpen, t, lang, setLang, searchQuery, setSearchQuery, isAdmin, hasBudgetEvents }) {
  const totalBadge = unreadCount + pendingCount;

  // Super admin : nav réduite
  const adminNav = [
    { key: "superadmin", icon: "⚡", label: "Super Admin" },
  ];

  // Utilisateur normal : nav complète
  const userNav = [
    { key: "dashboard",       icon: "◈", label: t("nav_dashboard") },
    { key: "events",          icon: "◉", label: t("nav_events") },
    { key: "expenses",        icon: "◫", label: t("nav_expenses") },
    { key: "contributions",   icon: "⊜", label: "Contributions" },
    { key: "analytics",       icon: "◐", label: t("nav_analytics") },
    { key: "history",         icon: "◷", label: t("nav_history") },
    { key: "invite",          icon: "◎", label: t("nav_invite") },
    { key: "notifications",   icon: "◬", label: t("nav_notifications"), badge: totalBadge },
    { key: "settings",        icon: "⚙", label: t("nav_settings") || "Paramètres" },
  ];

  // Bottom nav mobile : 5 onglets fixes
  const mobileNav = [
    { key: "dashboard",      icon: "◈", label: t("nav_dashboard") },
    { key: "events",         icon: "◉", label: t("nav_events") },
    { key: "expenses",       icon: "◫", label: t("nav_expenses") },
    { key: "contributions",  icon: "⊜", label: "Contributions" },
    { key: "analytics",      icon: "◐", label: t("nav_analytics") },
  ];

  const nav = isAdmin ? adminNav : userNav;

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
    const [pushEnabled, setPushEnabled] = useState(typeof Notification !== "undefined" && Notification.permission === "granted");

    const handlePushToggle = async () => {
      try {
        if (!("Notification" in window)) {
          addToast("Notifications non supportées sur ce navigateur.", "warning");
          return;
        }
        if (Notification.permission === "granted") {
          addToast("Notifications push déjà activées.", "info");
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          setPushEnabled(true);
          addToast("🔔 Notifications activées !", "success");
        } else {
          addToast("Notifications refusées. Autorisez-les dans les paramètres du navigateur.", "warning");
        }
      } catch (e) {
        addToast("Impossible d'activer les notifications.", "warning");
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
          <div style={{ color: "#F57F17", fontSize: 10, marginTop: 1 }}>✦ {isAdmin ? "Super Admin" : "Admin"}</div>
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
        {(isAdmin ? adminNav : mobileNav).map(n => (
          <button key={n.key} onClick={() => setActive(n.key)} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", color: active === n.key ? "#fff" : "#555", padding: "6px 4px", position: "relative", flex: 1, textAlign: "center" }}>
            <span style={{ fontSize: 19, display: "block", textAlign: "center" }}>{n.icon}</span>
            <span style={{ fontSize: 9, fontWeight: active === n.key ? 700 : 400, display: "block", textAlign: "center", width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {(n.label || "").replace(/^[⚡◈◉◫⊜◐◷◎◬⚙]\s*/, "").split(" ")[0] || n.label}
            </span>
            {n.badge > 0 && <span style={{ position: "absolute", top: 4, right: "50%", transform: "translateX(12px)", background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 9, fontWeight: 700, padding: "0 4px", minWidth: 14, textAlign: "center" }}>{n.badge}</span>}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <aside style={{ width: 260, minWidth: 260, background: "#0F0F0F", display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowX: "hidden", overflowY: "auto" }}>
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
function Dashboard({ events, expenses, contributions, user, isMobile, navigateTo, t, lang }) {
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] || "vous";
  const now = new Date();
  // Lire la langue sauvegardée depuis localStorage plutôt que le navigateur
  const savedLang = (() => { try { return localStorage.getItem("splitly_lang") || lang; } catch { return lang || "fr"; } })();
  const locale = savedLang === "ar" ? "ar-MA" : savedLang === "en" ? "en-GB" : savedLang === "es" ? "es-ES" : savedLang === "pt" ? "pt-PT" : "fr-FR";
  const dateLabel = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });

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
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 24, minWidth: 0 }}>
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

// ─── EXPORT PDF BUDGET ───────────────────────────────────────
function exportBudgetPDF(ev, expenses, cotisations) {
  const sym = currencySymbol(ev.currency);
  const fmt2 = n => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
  const evExp = expenses.filter(e => e.event_id === ev.id);
  const totalDepenses = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const totalRecettes = cotisations.filter(c => c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const solde = totalRecettes - totalDepenses;
  const participants = (ev.event_participants || []).map(p => p.name);
  const byCategory = Object.keys(CATEGORIES).map(cat => ({
    cat, total: evExp.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0)
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  const cotisationsRows = cotisations.map((c, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'}">
      <td style="padding:9px 12px;font-weight:600">${c.participant_name}</td>
      <td style="padding:9px 12px"><span class="badge" style="background:${c.forme === "nature" ? "#E8F5E9" : "#E3F2FD"};color:${c.forme === "nature" ? "#2E7D32" : "#1565C0"}">${c.forme === "nature" ? "🌿 Nature" : "💵 Espèces"}</span></td>
      <td style="padding:9px 12px"><span class="badge" style="background:${c.statut === "paye" ? "#E8F5E9" : "#FFEBEE"};color:${c.statut === "paye" ? "#2E7D32" : "#C62828"}">${c.statut === "paye" ? "✓ Payé" : c.statut === "partiel" ? "~ Partiel" : "✗ Impayé"}</span></td>
      <td style="padding:9px 12px;text-align:right;font-weight:700">${fmt2(c.montant)}</td>
    </tr>`).join('');

  const depensesRows = evExp.map((ex, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'}">
      <td style="padding:9px 12px">${CATEGORIES[ex.category]?.icon || ''} ${ex.category}</td>
      <td style="padding:9px 12px;font-weight:600">${ex.detail}</td>
      <td style="padding:9px 12px">${ex.paid_by || '—'}</td>
      <td style="padding:9px 12px;text-align:right;font-weight:700">${fmt2(ex.qty * (ex.unit_price ?? 0))}</td>
    </tr>`).join('');

  const catBars = byCategory.map(c => `
    <div class="cat-bar">
      <div class="cat-bar-label"><span>${CATEGORIES[c.cat]?.icon || '🏷️'} ${c.cat}</span><strong>${fmt2(c.total)} (${totalDepenses > 0 ? ((c.total / totalDepenses) * 100).toFixed(0) : 0}%)</strong></div>
      <div class="cat-bar-track"><div style="background:${CATEGORIES[c.cat]?.accent || '#F57F17'};height:6px;width:${totalDepenses > 0 ? (c.total / totalDepenses) * 100 : 0}%;border-radius:3px"></div></div>
    </div>`).join('');

  const infoBox = ev.nombre_invites > 0
    ? `<div class="info-box">💡 Coût par invité : <strong>${fmt2(totalDepenses / ev.nombre_invites)}</strong> · Cotisation moyenne : <strong>${fmt2(cotisations.length > 0 ? totalRecettes / cotisations.length : 0)}</strong></div>`
    : '';

  buildPDF({
    title: ev.name,
    subtitle: "Bilan financier complet",
    docType: "Rapport Bilan · Événement Budget",
    meta: [
      { label: "Date de l'événement", value: ev.date },
      { label: "Participants", value: `${participants.length} personne${participants.length > 1 ? 's' : ''}` },
      { label: "Devise", value: sym },
      ...(ev.nombre_invites > 0 ? [{ label: "Invités attendus", value: ev.nombre_invites }] : []),
    ],
    summaryItems: [
      { label: "Total recettes", value: fmt2(totalRecettes), sub: `${cotisations.filter(c => c.statut === "paye").length} cotisation(s)`, accent: "#2E7D32", color: "#2E7D32" },
      { label: "Total dépenses", value: fmt2(totalDepenses), sub: `${evExp.length} charge(s)`, accent: "#C62828", color: "#C62828" },
      { label: "Solde", value: `${solde >= 0 ? '+' : ''}${fmt2(solde)}`, sub: solde >= 0 ? "excédent" : "déficit", accent: solde >= 0 ? "#2E7D32" : "#C62828", color: solde >= 0 ? "#2E7D32" : "#C62828" },
    ],
    sections: [
      { title: `Cotisations (${cotisations.length})`, content: `<table><thead><tr><th>Participant</th><th>Forme</th><th>Statut</th><th style="text-align:right">Montant</th></tr></thead><tbody>${cotisationsRows}</tbody><tfoot><tr><td colspan="3">TOTAL RECETTES</td><td style="text-align:right;color:#2E7D32">${fmt2(totalRecettes)}</td></tr></tfoot></table>` },
      { title: `Dépenses (${evExp.length})`, content: `${infoBox}<table><thead><tr><th>Catégorie</th><th>Désignation</th><th>Responsable</th><th style="text-align:right">Montant</th></tr></thead><tbody>${depensesRows}</tbody><tfoot><tr><td colspan="3">TOTAL DÉPENSES</td><td style="text-align:right;color:#C62828">${fmt2(totalDepenses)}</td></tr></tfoot></table>` },
      { title: "Répartition par catégorie", content: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${catBars}</div>` },
    ],
  });
}

// ─── EVENT DETAIL (drill-down) ────────────────────────────────
function EventDetail({ ev, events, expenses, contributions, user, reload, isMobile, addToast, t, onBack }) {
  const [activeTab, setActiveTab] = useState("charges");
  const [cotisations, setCotisations] = useState([]);

  const evExp = expenses.filter(e => e.event_id === ev.id);
  const participants = (ev.event_participants || []).map(p => p.name);
  const sym = currencySymbol(ev.currency);
  const totalDepenses = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const isBudget = ev.event_type === "budget";

  useEffect(() => {
    if (isBudget) {
      fetchCotisations(ev.id).then(({ data }) => setCotisations(data || []));
    }
  }, [ev.id, isBudget]);

  const tabs = isBudget
    ? [
        { key: "charges",      icon: "◫", label: "Charges" },
        { key: "cotisations",  icon: "💰", label: "Cotisations" },
        { key: "analyses",     icon: "◐", label: "Analyses" },
      ]
    : [
        { key: "charges",      icon: "◫", label: "Charges" },
        { key: "repartition",  icon: "⊜", label: "Répartition" },
        { key: "analyses",     icon: "◐", label: "Analyses" },
      ];

  return (
    <div>
      {/* Header avec retour */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: "var(--hover-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 14px", fontSize: 13, cursor: "pointer", color: "var(--text)", fontFamily: "inherit", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          ← Retour
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 18 }}>{isBudget ? "🏦" : "🎊"}</span>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 18 : 22, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{ev.name}</h2>
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: isBudget ? "#FFF8E1" : "#F3E5F5", color: isBudget ? "#F57F17" : "#6A1B9A", fontWeight: 700, flexShrink: 0, border: `1px solid ${isBudget ? "#FFE082" : "#CE93D8"}` }}>
              {isBudget ? "Budget" : "Split"}
            </span>
            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: ev.status === "closed" ? "var(--hover-bg)" : "#E8F5E9", color: ev.status === "closed" ? "#999" : "#2E7D32", fontWeight: 700, flexShrink: 0 }}>
              {ev.status === "closed" ? "🔒 Bouclé" : "✓ Ouvert"}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 4 }}>
            {ev.date} · {sym} · {participants.length} participant{participants.length > 1 ? "s" : ""} · {evExp.length} charge{evExp.length > 1 ? "s" : ""}
            {isBudget && ev.nombre_invites > 0 && ` · ${ev.nombre_invites} invités attendus`}
          </div>
        </div>
        {/* Bouton PDF selon type */}
        {isBudget ? (
          <button onClick={() => exportBudgetPDF(ev, expenses, cotisations)}
            style={{ ...S.btnGhost, fontSize: 11, padding: "7px 12px", flexShrink: 0, whiteSpace: "nowrap" }}>
            📄 Bilan PDF
          </button>
        ) : (
          <button onClick={() => {
            const evExp = expenses.filter(e => e.event_id === ev.id);
            const contribMap = {};
            (contributions[ev.id] || []).forEach(c => { contribMap[c.participant] = c.amount; });
            exportPDF(ev, evExp, contribMap, participants);
          }} style={{ ...S.btnGhost, fontSize: 11, padding: "7px 12px", flexShrink: 0, whiteSpace: "nowrap" }}>
            📄 Bilan PDF
          </button>
        )}
      </div>

      {/* KPIs rapides */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
        <StatCard label="Budget" value={fmt(totalDepenses, sym)} sub={`${evExp.length} charge(s)`} accent="#0F0F0F" />
        <StatCard label="Participants" value={participants.length} sub="inscrits" accent="#1565C0" />
        {isBudget && <StatCard label="Collecté" value={fmt(cotisations.filter(c => c.statut === "paye").reduce((s, c) => s + c.montant, 0), sym)} sub="cotisations" accent="#2E7D32" />}
        {isBudget && ev.nombre_invites > 0 && <StatCard label="Invités" value={ev.nombre_invites} sub="attendus" accent="#F57F17" />}
        {!isBudget && <StatCard label="Devise" value={sym} sub={ev.currency} accent="#6A1B9A" />}
        {!isBudget && <StatCard label="Statut" value={ev.status === "closed" ? "Bouclé" : "Ouvert"} sub={ev.date} accent={ev.status === "closed" ? "#999" : "#2E7D32"} />}
      </div>

      {/* Onglets */}
      <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 12, padding: 3, gap: 2, marginBottom: 20, flexWrap: "wrap" }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: activeTab === tab.key ? "#0F0F0F" : "transparent", color: activeTab === tab.key ? "#fff" : "var(--text-muted)", fontSize: 12, fontWeight: activeTab === tab.key ? 700 : 400, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6 }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* Contenu onglets */}
      {activeTab === "charges" && (
        <>
          {ev.event_type === "budget" && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button onClick={() => exportChargesPDF(ev, evExp)}
                style={{ ...S.btnGhost, fontSize: 12, padding: "7px 14px" }}>📄 PDF Charges</button>
            </div>
          )}
          <Expenses
            events={events.filter(e => e.id === ev.id)}
            expenses={expenses}
            contributions={contributions}
            user={user}
            reload={reload}
            isMobile={isMobile}
            addToast={addToast}
            t={t}
            hideHeader={true}
            defaultEventId={ev.id}
          />
        </>
      )}
      {activeTab === "cotisations" && isBudget && (
        <CotisationsPage
          events={events.filter(e => e.id === ev.id)}
          expenses={expenses}
          user={user}
          reload={async () => {
            await reload();
            const { data } = await fetchCotisations(ev.id);
            setCotisations(data || []);
          }}
          isMobile={isMobile}
          addToast={addToast}
          t={t}
          hideHeader={true}
        />
      )}
      {activeTab === "repartition" && !isBudget && (
        <Balance
          events={events.filter(e => e.id === ev.id)}
          expenses={expenses}
          contributions={contributions}
          user={user}
          reload={reload}
          isMobile={isMobile}
          addToast={addToast}
          t={t}
          hideHeader={true}
          initialEvent={ev.id}
        />
      )}
      {activeTab === "analyses" && (
        <Analytics
          events={events.filter(e => e.id === ev.id)}
          expenses={expenses}
          contributions={contributions}
          isMobile={isMobile}
          t={t}
          defaultTab={isBudget ? "charges" : "event"}
        />
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
  const [form, setForm] = useState({ name: "", date: "", currency: "EUR €", participants: [], event_type: "split", cotisation_cible: "", nombre_invites: "" });
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [managingEv, setManagingEv] = useState(null);
  const [editingEv, setEditingEv] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editLoading, setEditLoading] = useState(false);
  const [newParticipant, setNewParticipant] = useState("");
  const [templates, setTemplates] = useState(getTemplates());
  const [showTemplates, setShowTemplates] = useState(false);
  const [sortEvents, setSortEvents] = useState("date_desc");

  const MAX_PARTICIPANTS = 30;
  const MAX_PARTICIPANTS_BUDGET = 150;
  const MAX_NAME_LENGTH = 50;
  const MAX_PARTICIPANT_NAME = 30;

  // Ouvrir modal édition événement
  const openEditEvent = (ev) => {
    setEditingEv(ev);
    setEditForm({
      name: ev.name,
      date: ev.date,
      currency: ev.currency,
      event_type: ev.event_type || "split",
      cotisation_cible: ev.cotisation_cible || "",
      nombre_invites: ev.nombre_invites || "",
    });
  };

  // Sauvegarder les modifications d'un événement
  const handleSaveEdit = async () => {
    if (!editForm.name?.trim()) { addToast("Le nom est obligatoire.", "warning"); return; }
    if (editForm.name.trim().length > 30) { addToast("Nom trop long (max 30 car.).", "warning"); return; }
    if (!editForm.date) { addToast("La date est obligatoire.", "warning"); return; }
    setEditLoading(true);
    const fields = {
      name: editForm.name.trim(),
      date: editForm.date,
      currency: editForm.currency,
      event_type: editForm.event_type,
      cotisation_cible: editForm.event_type === "budget" ? (parseFloat(editForm.cotisation_cible) || 0) : 0,
      nombre_invites: editForm.event_type === "budget" ? (parseInt(editForm.nombre_invites) || 0) : 0,
    };
    const { error } = await updateEvent(editingEv.id, fields, user.id);
    if (error) { addToast("Erreur : " + error.message, "error"); }
    else {
      await reload();
      setEditingEv(null);
      addToast("Événement modifié.", "success");
    }
    setEditLoading(false);
  };

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
    if (!form.name.trim()) { addToast("Le nom de l'événement est obligatoire.", "warning"); return; }
    if (form.name.trim().length > MAX_NAME_LENGTH) { addToast(`Le nom ne peut pas dépasser ${MAX_NAME_LENGTH} caractères.`, "warning"); return; }
    if (!form.date) { addToast("La date est obligatoire.", "warning"); return; }
    if (form.participants.length < 1) { addToast("Minimum 1 participant requis.", "warning"); return; }
    const maxP = form.event_type === "budget" ? MAX_PARTICIPANTS_BUDGET : MAX_PARTICIPANTS;
    if (form.participants.length > maxP) { addToast(`Maximum ${maxP} participants pour un événement ${form.event_type === "budget" ? "Budget" : "Split"}.`, "warning"); return; }
    setLoading(true);
    const eventData = {
      ...form,
      event_type: form.event_type || "split",
      cotisation_cible: form.event_type === "budget" ? (parseFloat(form.cotisation_cible) || 0) : 0,
      nombre_invites: form.event_type === "budget" ? (parseInt(form.nombre_invites) || 0) : 0,
    };
    const { error } = await createEvent(eventData, form.participants, user.id);
    if (!error) {
      await reload();
      setForm({ name: "", date: "", currency: "EUR €", participants: [], event_type: "split", cotisation_cible: "", nombre_invites: "" });
      setShowNew(false);
      addToast(`Événement ${form.event_type === "budget" ? "Budget" : "Split"} créé avec succès !`, "success");
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

    // Règle de bouclage selon le type d'événement
    if (ev.event_type === "budget") {
      // Option Budget : tous les participants doivent avoir cotisé (statut paye)
      const { data: cotisations } = await fetchCotisations(ev.id);
      const cotisants = new Set((cotisations || []).filter(c => c.statut === "paye").map(c => c.participant_name));
      const nonCotisants = participants.filter(p => !cotisants.has(p));
      if (nonCotisants.length > 0) {
        addToast(`Bouclage impossible — ${nonCotisants.length} participant(s) n'ont pas encore cotisé : ${nonCotisants.join(", ")}`, "warning");
        return;
      }
    } else {
      // Option Split : tous les participants doivent être soldés
      const allSettled = participants.every(p => isSettled(computeNetBalance(evExp, evContribMap, p)));
      if (!allSettled) { addToast("Tous les participants doivent solder avant de boucler.", "warning"); return; }
    }
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
    if (currentCount >= (ev?.event_type === "budget" ? MAX_PARTICIPANTS_BUDGET : MAX_PARTICIPANTS)) {
      addToast(`Maximum ${ev?.event_type === "budget" ? MAX_PARTICIPANTS_BUDGET : MAX_PARTICIPANTS} participants atteint.`, "warning"); return;
    }
    const existing = (ev.event_participants || []).map(p => p.name.toLowerCase());
    if (existing.includes(name.toLowerCase())) { addToast("Ce participant existe déjà.", "warning"); return; }
    await addParticipant(ev.id, name);
    await reload();
    setNewParticipant("");
    addToast(`${name} ajouté à l'événement.`, "success");
    setManagingEv(events.find(e => e.id === ev.id) || ev);
  };

  const [selectedEvent, setSelectedEvent] = useState(null); // null = liste, ev = détail

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

      {/* Modal édition événement */}
      {editingEv && (
        <Modal title={`✏️ Modifier — ${editingEv.name}`} onClose={() => setEditingEv(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={S.label}>Type d'événement</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                {[{ key: "split", icon: "💸", label: "Split" }, { key: "budget", icon: "🏦", label: "Budget" }].map(opt => (
                  <div key={opt.key} onClick={() => setEditForm({ ...editForm, event_type: opt.key })}
                    style={{ padding: "10px 14px", borderRadius: 10, border: `2px solid ${editForm.event_type === opt.key ? "#0F0F0F" : "var(--border)"}`, background: editForm.event_type === opt.key ? "#0F0F0F" : "var(--bg-secondary)", cursor: "pointer", transition: "all 0.15s", textAlign: "center" }}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{opt.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: editForm.event_type === opt.key ? "#fff" : "var(--text)" }}>{opt.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label style={S.label}>Nom <span style={{ color: (editForm.name?.length || 0) > 30 ? "#C62828" : "#aaa", fontWeight: 400 }}>{editForm.name?.length || 0}/30</span></label>
              <input style={{ ...S.input, borderColor: (editForm.name?.length || 0) > 30 ? "#C62828" : undefined }}
                value={editForm.name || ""} onChange={e => setEditForm({ ...editForm, name: e.target.value })} maxLength={50} />
              {(editForm.name?.length || 0) > 30 && <div style={{ fontSize: 11, color: "#C62828", marginTop: 3 }}>⚠️ Max 30 caractères</div>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={S.label}>Date</label>
                <input type="date" style={S.input} value={editForm.date || ""} onChange={e => setEditForm({ ...editForm, date: e.target.value })} />
              </div>
              <div>
                <label style={S.label}>Devise</label>
                <select style={S.input} value={editForm.currency || "EUR €"} onChange={e => setEditForm({ ...editForm, currency: e.target.value })}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {editForm.event_type === "budget" && (
              <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#F57F17", marginBottom: 10 }}>🏦 Options Budget</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={S.label}>Cotisation cible <span style={{ color: "#aaa", fontWeight: 400 }}>(opt.)</span></label>
                    <input type="number" min="0" step="0.01" style={S.input} placeholder="Ex: 50" value={editForm.cotisation_cible || ""} onChange={e => setEditForm({ ...editForm, cotisation_cible: e.target.value })} />
                  </div>
                  <div>
                    <label style={S.label}>Invités attendus <span style={{ color: "#aaa", fontWeight: 400 }}>(opt.)</span></label>
                    <input type="number" min="0" step="1" style={S.input} placeholder="Ex: 100" value={editForm.nombre_invites || ""} onChange={e => setEditForm({ ...editForm, nombre_invites: e.target.value })} />
                  </div>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSaveEdit} disabled={editLoading || (editForm.name?.length || 0) > 30}
                style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", opacity: (editForm.name?.length || 0) > 30 ? 0.5 : 1 }}>
                {editLoading ? "Enregistrement..." : "✓ Enregistrer"}
              </button>
              <button onClick={() => setEditingEv(null)} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Vue détail événement (drill-down) ── */}
      {selectedEvent && (
        <EventDetail
          ev={selectedEvent}
          events={events}
          expenses={expenses}
          contributions={contributions}
          user={user}
          reload={reload}
          isMobile={isMobile}
          addToast={addToast}
          t={t}
          onBack={() => setSelectedEvent(null)}
        />
      )}

      {/* ── Vue liste événements ── */}
      {!selectedEvent && (
      <div>
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
                <span style={{ fontSize: 11, color: (managingEv.event_participants || []).length >= (managingEv.event_type === "budget" ? MAX_PARTICIPANTS_BUDGET : MAX_PARTICIPANTS) ? "#C62828" : "#aaa", fontWeight: 600 }}>
                  {(managingEv.event_participants || []).length}/{managingEv.event_type === "budget" ? MAX_PARTICIPANTS_BUDGET : MAX_PARTICIPANTS} participants
                </span>
              </div>
              {(managingEv.event_participants || []).length >= (managingEv.event_type === "budget" ? MAX_PARTICIPANTS_BUDGET : MAX_PARTICIPANTS) ? (
                <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#C62828" }}>
                  ⚠️ Maximum {managingEv.event_type === "budget" ? MAX_PARTICIPANTS_BUDGET : MAX_PARTICIPANTS} participants atteint.
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

          {/* ── Sélection du type ── */}
          <div style={{ marginBottom: 20 }}>
            <label style={S.label}>Type d'événement</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
              {[
                { key: "split", icon: "💸", title: "Split", desc: "Répartition des dépenses entre participants" },
                { key: "budget", icon: "🏦", title: "Budget", desc: "Gestion des recettes et dépenses d'un événement commun" },
              ].map(opt => (
                <div key={opt.key} onClick={() => setForm({ ...form, event_type: opt.key })}
                  style={{ padding: "14px 16px", borderRadius: 12, border: `2px solid ${form.event_type === opt.key ? "#0F0F0F" : "var(--border)"}`, background: form.event_type === opt.key ? "#0F0F0F" : "var(--bg-secondary)", cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{opt.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: form.event_type === opt.key ? "#fff" : "var(--text)", marginBottom: 4 }}>{opt.title}</div>
                  <div style={{ fontSize: 11, color: form.event_type === opt.key ? "rgba(255,255,255,0.65)" : "var(--text-sub)", lineHeight: 1.5 }}>{opt.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Champs communs ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={S.label}>Nom de l'événement <span style={{ color: form.name.length > 30 ? "#C62828" : "#aaa", fontWeight: form.name.length > 30 ? 700 : 400 }}>{form.name.length}/30</span></label>
              <input style={{ ...S.input, borderColor: form.name.length > 30 ? "#C62828" : undefined }} placeholder="Ex: Fête de fin d'année" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={50} />
              {form.name.length > 30 && <div style={{ fontSize: 11, color: "#C62828", marginTop: 4, fontWeight: 600 }}>⚠️ Limite de 30 caractères dépassée ({form.name.length}/30)</div>}
            </div>
            <div><label style={S.label}>Date</label><input type="date" style={S.input} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
              <label style={S.label}>Devise</label>
              <select style={{ ...S.input, maxWidth: 220 }} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* ── Champs spécifiques Budget ── */}
          {form.event_type === "budget" && (
            <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#F57F17", marginBottom: 12 }}>🏦 Options Budget</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={S.label}>Cotisation cible par participant <span style={{ color: "#aaa", fontWeight: 400 }}>(optionnel)</span></label>
                  <input type="number" min="0" step="0.01" style={S.input} placeholder="Ex: 50" value={form.cotisation_cible} onChange={e => setForm({ ...form, cotisation_cible: e.target.value })} />
                </div>
                <div>
                  <label style={S.label}>Nombre d'invités attendus <span style={{ color: "#aaa", fontWeight: 400 }}>(optionnel)</span></label>
                  <input type="number" min="0" step="1" style={S.input} placeholder="Ex: 100" value={form.nombre_invites} onChange={e => setForm({ ...form, nombre_invites: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          {/* ── Participants ── */}
          <div style={{ marginBottom: 18 }}>
            <ParticipantInput participants={form.participants} onChange={p => setForm({ ...form, participants: p })} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleCreate} disabled={loading || form.participants.length < 1 || form.name.trim().length > 30}
              style={{ ...S.btnDark, opacity: (form.participants.length < 1 || form.name.trim().length > 30) ? 0.5 : 1 }}>
              {loading ? "Création..." : `Créer l'événement ${form.event_type === "budget" ? "🏦" : "💸"}`}
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
            const allSettled = ev.event_type === "budget"
              ? participants.length > 0 && settledCount === participants.length
              : participants.length > 0 && settledCount === participants.length;
            const progress = participants.length > 0 ? (settledCount / participants.length) * 100 : 0;

            return (
              <div key={ev.id} onClick={() => setSelectedEvent(ev)}
                style={{ background: "var(--bg-secondary)", borderRadius: 16, padding: isMobile ? "14px" : "18px 22px", border: `1px solid ${ev.event_type === "budget" ? "#FFE082" : "var(--border)"}`, boxShadow: "0 2px 8px rgba(0,0,0,0.04)", cursor: "pointer", transition: "box-shadow 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)"}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)"}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  {/* Icône */}
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: ev.status === "closed" ? "var(--hover-bg)" : ev.event_type === "budget" ? "#FFF8E1" : "#f0faf4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                    {ev.status === "closed" ? "🔒" : ev.event_type === "budget" ? "🏦" : "🎊"}
                  </div>

                  {/* Contenu principal */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Ligne 1 : Nom + badges */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "nowrap", minWidth: 0 }}>
                      <span style={{ fontSize: isMobile ? 14 : 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{ev.name}</span>
                      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: ev.event_type === "budget" ? "#FFF8E1" : "#F3E5F5", color: ev.event_type === "budget" ? "#F57F17" : "#6A1B9A", fontWeight: 700, flexShrink: 0, border: `1px solid ${ev.event_type === "budget" ? "#FFE082" : "#CE93D8"}`, whiteSpace: "nowrap" }}>
                        {ev.event_type === "budget" ? "🏦" : "💸"}
                      </span>
                      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: ev.status === "closed" ? "var(--hover-bg)" : allSettled ? "#E8F5E9" : "#fff8e1", color: ev.status === "closed" ? "#999" : allSettled ? "#2E7D32" : "#F57F17", fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" }}>
                        {ev.status === "closed" ? "🔒" : allSettled ? "✓" : "•"}
                      </span>
                    </div>

                    {/* Ligne 2 : Info compacte sur une seule ligne */}
                    <div style={{ fontSize: 11, color: "var(--text-sub)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ev.date} · {currencySymbol(ev.currency)} · {evExp.length} charge{evExp.length > 1 ? "s" : ""}
                      {ev.event_type === "budget" && ev.nombre_invites > 0 && ` · ${ev.nombre_invites} inv.`}
                    </div>

                    {/* Ligne 3 : Participants + gérer */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: ev.status === "open" ? 10 : 0 }}>
                      <AvatarStack names={participants} size={22} />
                      <button onClick={e => { e.stopPropagation(); setManagingEv(ev); }}
                        style={{ fontSize: 11, color: "#1565C0", background: "#E3F2FD", border: "none", borderRadius: 8, padding: "3px 10px", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                        👥 Gérer
                      </button>
                    </div>

                    {/* Progression */}
                    {ev.status === "open" && (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontSize: 10, color: "var(--text-sub)" }}>
                            {ev.event_type === "budget" ? "Collecte" : "Bouclage"}
                          </span>
                          <span style={{ fontSize: 10, color: allSettled ? "#2E7D32" : "#F57F17", fontWeight: 700 }}>{settledCount}/{participants.length}</span>
                        </div>
                        <div style={{ background: "var(--border)", borderRadius: 6, height: 5, overflow: "hidden" }}>
                          <div style={{ background: allSettled ? "#2E7D32" : "#F57F17", borderRadius: 6, height: 5, width: `${progress}%`, transition: "width 0.4s ease" }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Colonne droite : montant + actions */}
                  <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <div>
                      <div style={{ fontSize: isMobile ? 14 : 17, fontWeight: 700, fontFamily: "'Playfair Display', serif", whiteSpace: "nowrap" }}>{fmt(evTotal, currencySymbol(ev.currency))}</div>
                      <div style={{ fontSize: 10, color: "var(--text-sub)" }}>{ev.event_type === "budget" ? "dépenses" : "budget"}</div>
                    </div>
                    {ev.status === "open" && (
                      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 4, alignItems: "flex-end" }} onClick={e => e.stopPropagation()}>
                        <button onClick={e => { e.stopPropagation(); handleSaveTemplate(ev); }} title="Modèle"
                          style={{ padding: isMobile ? "4px 8px" : "5px 12px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--hover-bg)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                          📋
                        </button>
                        <button onClick={e => { e.stopPropagation(); openEditEvent(ev); }} title="Modifier"
                          style={{ padding: isMobile ? "4px 8px" : "5px 12px", borderRadius: 8, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 11, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                          ✏️
                        </button>
                        {allSettled && (
                          <button onClick={e => { e.stopPropagation(); handleClose(ev); }} style={{ ...S.btnDark, padding: isMobile ? "4px 8px" : "5px 12px", fontSize: 11, background: "#2E7D32", borderRadius: 8, whiteSpace: "nowrap" }}>
                            🔒
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); handleDelete(ev); }} style={{ padding: isMobile ? "4px 8px" : "5px 12px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
                          🗑
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
      )}
    </div>
  );
}

// ─── EXPORT PDF CHARGES ──────────────────────────────────────
function exportChargesPDF(ev, evExpenses) {
  const sym = currencySymbol(ev.currency);
  const fmt2 = n => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
  const total = evExpenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const participants = (ev.event_participants || []).map(p => p.name);
  const byCategory = Object.keys(CATEGORIES).map(cat => ({
    cat, total: evExpenses.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0)
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  const rows = evExpenses.map((ex, i) => {
    const exTotal = ex.qty * (ex.unit_price ?? 0);
    return `<tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'}">
      <td style="padding:9px 12px">${CATEGORIES[ex.category]?.icon || ''} ${ex.category}</td>
      <td style="padding:9px 12px;font-weight:600">${ex.detail}</td>
      <td style="padding:9px 12px">${ex.paid_by || '—'}</td>
      <td style="padding:9px 12px;text-align:center">${ex.qty > 1 ? `${ex.qty} × ${fmt2(ex.unit_price ?? 0)}` : '—'}</td>
      <td style="padding:9px 12px;text-align:right;font-weight:700">${fmt2(exTotal)}</td>
    </tr>`;
  }).join('');

  const catBars = byCategory.map(c => `
    <div class="cat-bar">
      <div class="cat-bar-label">
        <span>${CATEGORIES[c.cat]?.icon || '🏷️'} ${c.cat}</span>
        <strong style="color:${CATEGORIES[c.cat]?.accent || '#333'}">${fmt2(c.total)} (${total > 0 ? ((c.total / total) * 100).toFixed(0) : 0}%)</strong>
      </div>
      <div class="cat-bar-track"><div style="background:${CATEGORIES[c.cat]?.accent || '#aaa'};height:6px;width:${total > 0 ? (c.total / total) * 100 : 0}%;border-radius:3px"></div></div>
    </div>`).join('');

  buildPDF({
    title: ev.name,
    subtitle: `Bilan des charges${ev.event_type === "budget" ? " — Événement Budget" : ""}`,
    docType: ev.event_type === "budget" ? "Rapport Charges · Événement Budget" : "Rapport Charges · Événement Split",
    meta: [
      { label: "Date de l'événement", value: ev.date },
      { label: "Participants", value: `${participants.length} personne${participants.length > 1 ? 's' : ''}` },
      { label: "Devise", value: sym },
      ...(ev.nombre_invites > 0 ? [{ label: "Invités attendus", value: ev.nombre_invites }] : []),
    ],
    summaryItems: [
      { label: "Total dépenses", value: fmt2(total), sub: `${evExpenses.length} charge(s)`, accent: "#C62828", color: "#C62828" },
      { label: "Catégories", value: byCategory.length, sub: "catégories actives", accent: "#1565C0" },
      { label: "Moy. / charge", value: fmt2(evExpenses.length > 0 ? total / evExpenses.length : 0), sub: "par dépense", accent: "#F57F17" },
      ...(ev.nombre_invites > 0 ? [{ label: "Coût / invité", value: fmt2(total / ev.nombre_invites), sub: `sur ${ev.nombre_invites} invités`, accent: "#6A1B9A" }] : []),
    ],
    sections: [
      { title: "Répartition par catégorie", content: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${catBars}</div>` },
      {
        title: `Détail des charges (${evExpenses.length})`,
        content: `<table>
          <thead><tr><th>Catégorie</th><th>Désignation</th><th>Responsable</th><th style="text-align:center">Détail</th><th style="text-align:right">Montant</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="4">TOTAL DÉPENSES</td><td style="text-align:right;color:#C62828">${fmt2(total)}</td></tr></tfoot>
        </table>`
      },
    ],
  });
}

// ─── CHARGES ──────────────────────────────────────────────────
function Expenses({ events, expenses, contributions, user, reload, isMobile, addToast, t, hideHeader, defaultEventId }) {
  const [showForm, setShowForm] = useState(false);
  const [filterEvent, setFilterEvent] = useState(defaultEventId || "all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [sortBy, setSortBy] = useState("date_desc");
  const [searchText, setSearchText] = useState("");
  const [editingEx, setEditingEx] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [unpaid, setUnpaid] = useState(false);
  const empty = { eventId: defaultEventId || "", category: "", sub: "", detail: "", qty: 1, unit: "", paidBy: "", included: [], comment: "", acompteRecu: "" };
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
  const sym = currencySymbol(currentEvent?.currency);

  const handleSave = async () => {
    const isBudgetEvent = currentEvent?.event_type === "budget";
    // Pour Budget : included = tous les participants automatiquement
    const finalIncluded = isBudgetEvent ? participants : form.included;
    if (!form.eventId || !form.category || !form.sub || !form.detail) {
      addToast(t("toast_fill_all"), "warning"); return;
    }
    if (!isBudgetEvent && finalIncluded.length === 0) {
      addToast("Sélectionnez au moins une personne.", "warning"); return;
    }
    if (!unpaid && !form.paidBy) {
      addToast("Sélectionnez un responsable ou cochez 'Charge non réglée'.", "warning"); return;
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

      await updateExpense(editingEx.id, { ...form, included: finalIncluded, qty, unit, is_unpaid: unpaid }, user.id, editingEx);
      addToast(t("toast_expense_edited"), "success");
    } else {
      // Nouvelle charge
      await createExpense({ ...form, included: finalIncluded, qty, unit, is_unpaid: unpaid }, user.id);

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
      {!hideHeader && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>Charges</h2>
          <p style={{ color: "#888", fontSize: 12 }}>{expenses.length} dépense{expenses.length > 1 ? "s" : ""}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {filterEvent !== "all" && events.find(e => e.id === filterEvent) && (
            <button onClick={() => {
              const ev = events.find(e => e.id === filterEvent);
              const evExp = expenses.filter(e => e.event_id === filterEvent);
              exportChargesPDF(ev, evExp);
            }} style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }}>📄 PDF Charges</button>
          )}
          <button onClick={() => { setForm(empty); setEditingEx(null); setShowForm(!showForm); }}
            style={S.btnDark}>{showForm && !editingEx ? "× Fermer" : "+ Ajouter"}</button>
        </div>
      </div>}
      {hideHeader && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button onClick={() => { setForm({ ...empty, eventId: defaultEventId || "" }); setEditingEx(null); setShowForm(!showForm); }}
          style={S.btnDark}>{showForm && !editingEx ? "× Fermer" : "+ Ajouter une charge"}</button>
      </div>}

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
            return <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name} ({count})</option>;
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

      {/* Bandeau info si événement Budget sélectionné */}
      {filterEvent !== "all" && events.find(e => e.id === filterEvent)?.event_type === "budget" && (
        <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span style={{ fontSize: 16 }}>🏦</span>
          <div>
            <span style={{ fontWeight: 700, color: "#F57F17" }}>Événement Budget</span>
            <span style={{ color: "#E65100", marginLeft: 8 }}>— Les charges ici représentent les dépenses effectuées par les responsables. Gérez les cotisations dans l'onglet <strong>Cotisations</strong>.</span>
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16, border: editingEx ? "1.5px solid #F57F17" : "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={S.sectionTitle}>{editingEx ? "✏️ Modifier la charge" : "➕ Nouvelle charge"}</div>
            {editingEx && <span style={{ fontSize: 11, color: "#F57F17", fontWeight: 600 }}>Mode édition</span>}
          </div>

          {/* Bandeau Budget */}
          {currentEvent?.event_type === "budget" && (
            <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#F57F17" }}>
              🏦 <strong>Événement Budget</strong> — Le "Responsable" est la personne qui effectue la dépense. Précisez l'acompte reçu de la caisse si applicable.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={S.label}>Événement</label>
              <select style={S.input} value={form.eventId} onChange={e => handleEventChange(e.target.value)} disabled={!!editingEx || !!defaultEventId}>
                <option value="">Sélectionner...</option>
                {events.filter(e => e.status === "open").map(ev => <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>{currentEvent?.event_type === "budget" ? "Responsable de la dépense" : "Payé par"}</label>
              <select style={{ ...S.input, opacity: unpaid ? 0.5 : 1 }} value={form.paidBy} onChange={e => setForm({ ...form, paidBy: e.target.value })} disabled={!currentEvent || unpaid}>
                <option value="">Sélectionner...</option>
                {participants.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* Acompte reçu — uniquement pour Budget */}
          {currentEvent?.event_type === "budget" && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={S.label}>Acompte reçu de la caisse <span style={{ color: "#aaa", fontWeight: 400 }}>(optionnel)</span></label>
                <input type="number" min="0" step="0.01" style={S.input} placeholder="Ex: 100"
                  value={form.acompteRecu} onChange={e => setForm({ ...form, acompteRecu: e.target.value })} />
                {form.acompteRecu && form.unit && form.qty && (
                  <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600,
                    color: (Number(form.acompteRecu) - Number(form.qty) * Number(form.unit)) >= 0 ? "#F57F17" : "#C62828" }}>
                    {(Number(form.acompteRecu) - Number(form.qty) * Number(form.unit)) >= 0
                      ? `✓ Reste ${(Number(form.acompteRecu) - Number(form.qty) * Number(form.unit)).toFixed(2)} ${sym} à rendre à la caisse`
                      : `⚠️ Dépassement de ${Math.abs(Number(form.acompteRecu) - Number(form.qty) * Number(form.unit)).toFixed(2)} ${sym} — caisse doit rembourser`}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ background: "#f5f5f5", borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#888", width: "100%" }}>
                  💡 Si aucun acompte n'a été reçu, laissez vide. La caisse devra rembourser intégralement ce responsable.
                </div>
              </div>
            </div>
          )}

          {/* Toggle charge non réglée — masqué pour Budget */}
          {currentEvent?.event_type !== "budget" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "12px 16px", borderRadius: 12, background: unpaid ? "#FFF8E1" : "#fafafa", border: `1.5px solid ${unpaid ? "#F57F17" : "#eee"}`, transition: "all 0.2s" }}>
              <div style={{ position: "relative", width: 40, height: 22, flexShrink: 0 }} onClick={() => { setUnpaid(!unpaid); if (!unpaid) setForm(f => ({ ...f, paidBy: "" })); }}>
                <div style={{ position: "absolute", inset: 0, background: unpaid ? "#F57F17" : "#ddd", borderRadius: 11, transition: "background 0.2s" }} />
                <div style={{ position: "absolute", top: 3, left: unpaid ? 21 : 3, width: 16, height: 16, background: "#fff", borderRadius: "50%", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: unpaid ? "#E65100" : "#333" }}>⏳ Charge non encore réglée</div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{unpaid ? "Aucune contribution ne sera créditée." : "Décochez si personne n'a encore payé."}</div>
              </div>
            </label>
          </div>
          )}

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
          {currentEvent && currentEvent.event_type !== "budget" && (
            <div style={{ marginBottom: 16, padding: 16, background: "var(--hover-bg)", borderRadius: 12, border: "1px solid var(--border)" }}>
              <ParticipantToggle people={participants} selected={form.included} onChange={p => setForm({ ...form, included: p })} label="Qui partage cette charge ?" />
              {form.included.length > 0 && total > 0 && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "#E8F5E9", borderRadius: 10, fontSize: 13, color: "#2E7D32", fontWeight: 600 }}>
                  ➗ {sharePerPerson.toFixed(2)} {currencySymbol(currentEvent?.currency)} / personne · {form.included.length} inclus
                </div>
              )}
              {form.included.length === 0 && <div style={{ marginTop: 8, fontSize: 12, color: "#C62828" }}>⚠️ Sélectionnez au moins une personne</div>}
            </div>
          )}
          {currentEvent && currentEvent.event_type === "budget" && (
            <div style={{ background: "#E8F5E9", border: "1px solid #C8E6C9", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#2E7D32" }}>
              ✓ Cette charge sera attribuée à l'ensemble des participants de l'événement ({participants.length} personnes).
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
function Balance({ events, expenses, contributions, user, reload, isMobile, addToast, t, initialEvent, hideHeader }) {
  const [filterEvent, setFilterEvent] = useState(initialEvent || events[0]?.id || "");
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
        {!hideHeader && <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>
            {ev?.event_type === "budget" ? "🏦 Caisse" : (t ? t("bal_title") : "Répartition")}
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>
            {ev?.event_type === "budget" ? "Soldes caisse et remboursements responsables" : (t ? t("bal_subtitle") : "Soldes calculés en temps réel")}
          </p>
        </div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!hideHeader && <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}</option>)}
          </select>}
          {ev?.event_type !== "budget" && <>
            <button onClick={handleExportPDF} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>{t ? t("bal_pdf") : "📄 PDF"}</button>
            <button onClick={handleExportExcel} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>📊 CSV</button>
          </>}
        </div>
      </div>

      {/* ── Si événement Budget → vue Caisse (Phase 4c) ── */}
      {ev?.event_type === "budget" && (
        <BudgetCaisseView ev={ev} expenses={expenses} isMobile={isMobile} addToast={addToast} t={t} />
      )}

      {/* ── Si événement Split → vue Répartition normale ── */}
      {ev?.event_type !== "budget" && (participants.length === 0 ? (
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
      ))}
    </div>
  );
}

// ─── BUDGET CAISSE VIEW (placeholder Phase 4c) ───────────────
function BudgetCaisseView({ ev, expenses, isMobile, addToast, t }) {
  const evExp = expenses.filter(e => e.event_id === ev?.id);
  const sym = currencySymbol(ev?.currency);
  const totalDepenses = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);

  return (
    <div>
      <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 12, padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20 }}>🏦</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#F57F17" }}>Vue Caisse — en cours de développement</div>
          <div style={{ fontSize: 12, color: "#E65100", marginTop: 2 }}>La gestion complète de la caisse sera disponible dans la prochaine mise à jour (Phase 4c).</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 12 }}>
        <StatCard label="Total dépenses" value={fmt(totalDepenses, sym)} sub={`${evExp.length} charge(s)`} accent="#C62828" />
        <StatCard label="Invités attendus" value={ev?.nombre_invites || "—"} sub="personnes" accent="#1565C0" />
        <StatCard label="Cotisation cible" value={ev?.cotisation_cible > 0 ? fmt(ev.cotisation_cible, sym) : "Libre"} sub="par participant" accent="#2E7D32" />
      </div>
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
function Analytics({ events, expenses, contributions, isMobile, t, defaultTab }) {
  const [tab, setTab] = useState(defaultTab || "all"); // "all" | "event" | "charges" | "personal"
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
  const splitEvents = events.filter(e => e.event_type !== "budget");
  const budgetEvents = events.filter(e => e.event_type === "budget");

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
            <StatCard label="Événements" value={events.length} sub={`${splitEvents.length} Split · ${budgetEvents.length} Budget`} accent="#0F0F0F" />
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
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ flexShrink: 0 }}>{ev.status === "closed" ? "🔒" : ev.event_type === "budget" ? "🏦" : "🎊"}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Truncate text={ev.name} max={16} /></span>
                            </div>
                            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 20, background: ev.event_type === "budget" ? "#FFF8E1" : "#F3E5F5", color: ev.event_type === "budget" ? "#F57F17" : "#6A1B9A", fontWeight: 700, width: "fit-content" }}>
                              {ev.event_type === "budget" ? "Budget" : "Split"}
                            </span>
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
// ─── PERMISSIONS ──────────────────────────────────────────────
// read_only est implicite — ce n'est PAS un droit qu'on accorde, c'est l'état par défaut
// Un invité sans permissions = lecture seule automatiquement
const ALL_PERMISSIONS = {
  add_expense:         { label: "Ajouter charge",          icon: "➕",  desc: "Créer de nouvelles charges", color: "#1565C0", bg: "#E3F2FD", split: true, budget: true },
  edit_expense:        { label: "Modifier charge",         icon: "✏️",  desc: "Modifier les charges existantes", color: "#F57F17", bg: "#FFF8E1", split: true, budget: true },
  delete_expense:      { label: "Supprimer charge",        icon: "🗑",  desc: "Supprimer des charges", color: "#C62828", bg: "#FFEBEE", split: true, budget: true },
  add_participant:     { label: "Ajouter participant",     icon: "👤+", desc: "Ajouter des participants", color: "#2E7D32", bg: "#E8F5E9", split: true, budget: true },
  remove_participant:  { label: "Supprimer participant",   icon: "👤-", desc: "Retirer des participants", color: "#C62828", bg: "#FFEBEE", split: true, budget: true },
  add_cotisation:      { label: "Ajouter cotisation",      icon: "💰+", desc: "Créer des cotisations", color: "#6A1B9A", bg: "#F3E5F5", split: false, budget: true },
  edit_cotisation:     { label: "Modifier cotisation",     icon: "💰✏", desc: "Modifier les cotisations", color: "#6A1B9A", bg: "#F3E5F5", split: false, budget: true },
  export_pdf:          { label: "Exporter PDF",            icon: "📄",  desc: "Générer des PDF", color: "#0F0F0F", bg: "#f0f0f0", split: true, budget: true },
};

// Retourne les permissions disponibles pour un type d'événement (jamais read_only)
function getAvailablePermissions(eventType) {
  return Object.entries(ALL_PERMISSIONS)
    .filter(([, p]) => eventType === "budget" ? p.budget : p.split)
    .map(([key, p]) => ({ key, ...p }));
}

// Vérifie si un invité a une permission spécifique
// Un tableau vide ou null = lecture seule (aucun droit supplémentaire)
function hasPermission(permissions, perm) {
  if (!permissions || permissions.length === 0) return false;
  // Compatibilité ascendante : ancienne valeur "read_only" = aucun droit
  const filtered = permissions.filter(p => p !== "read_only");
  return filtered.includes(perm);
}

// Normalise les permissions : retire read_only, déduplique
function normalizePerms(perms) {
  if (!perms) return [];
  return [...new Set(perms.filter(p => p !== "read_only"))];
}

// Badge lecture seule ou droits actifs
function PermissionSummaryBadge({ permissions }) {
  const perms = normalizePerms(permissions);
  if (perms.length === 0) {
    return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "#f5f5f5", color: "#888", fontWeight: 700 }}>👁 Lecture seule</span>;
  }
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {perms.map(p => {
        const info = ALL_PERMISSIONS[p];
        return info ? (
          <span key={p} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: info.bg, color: info.color, fontWeight: 700 }}>
            {info.icon} {info.label}
          </span>
        ) : null;
      })}
    </div>
  );
}

// ─── INVITE ───────────────────────────────────────────────────
function Invite({ events, user, isMobile, addToast }) {
  const [email, setEmail] = useState("");
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [saving, setSaving] = useState(false);

  // Gestionnaire de droits refonte
  const [managerEmail, setManagerEmail] = useState(null); // email géré
  const [managerMode, setManagerMode] = useState("by_event"); // "by_event" | "selection" | "all"
  const [managerPerms, setManagerPerms] = useState({}); // { eventId: [perms] }
  const [selectionPerms, setSelectionPerms] = useState([]); // perms communes pour "selection"
  const [selectionEvents, setSelectionEvents] = useState([]); // events sélectionnés pour "selection"
  const [allPerms, setAllPerms] = useState([]); // perms pour "all"
  const [confirmAll, setConfirmAll] = useState(false); // visa fort pour "all"
  const [savingPerms, setSavingPerms] = useState(false);

  const loadInvites = async () => {
    const all = [];
    for (const ev of events) {
      const { data } = await fetchInvitations(ev.id);
      if (data) all.push(...data.map(i => ({ ...i, eventName: ev.name, eventType: ev.event_type })));
    }
    setInvitations(all);
  };

  useEffect(() => { if (events.length > 0) loadInvites(); }, [events]);

  // Invitations groupées par email
  const invitationsByEmail = invitations.reduce((acc, inv) => {
    if (!acc[inv.email]) acc[inv.email] = [];
    acc[inv.email].push(inv);
    return acc;
  }, {});

  const handleSend = async () => {
    if (!email) { addToast("Entrez un email.", "warning"); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { addToast("Format d'email invalide.", "warning"); return; }
    if (selectedEvents.length === 0) { addToast("Sélectionnez au moins un événement.", "warning"); return; }
    setSaving(true);
    const finalPerms = normalizePerms(permissions);
    // Vérifier doublons
    const existing = invitations.filter(i => i.email === email && selectedEvents.includes(i.event_id));
    if (existing.length > 0 && existing.length === selectedEvents.length) {
      setSaving(false);
      addToast(`${email} est déjà invité sur ces événements. Modifiez ses droits.`, "info");
      openManager(email);
      return;
    }
    for (const evId of selectedEvents) {
      const alreadyExists = invitations.find(i => i.email === email && i.event_id === evId);
      if (!alreadyExists) {
        await sendInvitation({ eventId: evId, email, role: finalPerms.length > 0 ? "edit" : "read", invitedBy: user.id, permissions: finalPerms });
      }
    }
    setEmail(""); setSelectedEvents([]); setPermissions([]);
    await loadInvites();
    setSaving(false);
    addToast(`Invitation envoyée à ${email}.`, "success");
  };

  const handleRemove = async (inv) => {
    await removeInvitation(inv.event_id, inv.email);
    await loadInvites();
    addToast("Accès retiré.", "info");
  };

  // Ouvrir le gestionnaire de droits pour un email
  const openManager = (guestEmail) => {
    const guestInvs = invitations.filter(i => i.email === guestEmail);
    // Construire la map initiale de perms par event
    const pMap = {};
    guestInvs.forEach(i => { pMap[i.event_id] = normalizePerms(i.permissions); });
    setManagerEmail(guestEmail);
    setManagerMode("by_event");
    setManagerPerms(pMap);
    setSelectionPerms([]);
    setSelectionEvents([]);
    setAllPerms([]);
    setConfirmAll(false);
  };

  const closeManager = () => {
    setManagerEmail(null);
    setConfirmAll(false);
  };

  const handleSaveManager = async () => {
    if (!managerEmail) return;
    setSavingPerms(true);
    const guestInvs = invitations.filter(i => i.email === managerEmail);
    try {
      if (managerMode === "by_event") {
        // Enregistrer chaque événement individuellement
        for (const inv of guestInvs) {
          const perms = managerPerms[inv.event_id] || [];
          await updateInvitationPermissions(inv.event_id, managerEmail, perms, false);
        }
        addToast(`Droits mis à jour pour ${managerEmail}.`, "success");
      } else if (managerMode === "selection") {
        for (const evId of selectionEvents) {
          await updateInvitationPermissions(evId, managerEmail, selectionPerms, false);
        }
        addToast(`Droits appliqués sur ${selectionEvents.length} événement(s).`, "success");
      } else if (managerMode === "all") {
        if (!confirmAll) { addToast("Cochez la confirmation pour appliquer à tous les événements.", "warning"); setSavingPerms(false); return; }
        // Appliquer à tous (actuels + futurs via applyToAll=true)
        await updateInvitationPermissions(guestInvs[0]?.event_id, managerEmail, allPerms, true);
        addToast(`Droits appliqués à TOUS les événements (actuels et futurs) pour ${managerEmail}.`, "success");
      }
      await loadInvites();
      closeManager();
    } catch (e) { addToast("Erreur : " + e.message, "error"); }
    setSavingPerms(false);
  };

  const togglePerm = (perms, setPerms, key) => {
    setPerms(perms.includes(key) ? perms.filter(p => p !== key) : [...perms, key]);
  };

  const PermBadge = ({ perm }) => {
    if (perm === "read_only") return <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#f5f5f5", color: "#888", fontWeight: 700 }}>👁 Lecture seule</span>;
    const p = ALL_PERMISSIONS[perm];
    if (!p) return null;
    return <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: p.bg, color: p.color, fontWeight: 700, border: `1px solid ${p.color}22`, whiteSpace: "nowrap" }}>{p.icon} {p.label}</span>;
  };

  // Composant checkboxes de permissions réutilisable
  const PermCheckboxes = ({ eventType, perms, onToggle }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {getAvailablePermissions(eventType || "split").map(p => (
        <label key={p.key} onClick={() => onToggle(p.key)}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 9, border: `1.5px solid ${perms.includes(p.key) ? p.color : "var(--border)"}`, background: perms.includes(p.key) ? p.bg : "var(--bg-secondary)", cursor: "pointer", transition: "all 0.15s" }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${perms.includes(p.key) ? p.color : "#ccc"}`, background: perms.includes(p.key) ? p.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {perms.includes(p.key) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
          </div>
          <span style={{ fontSize: 12 }}>{p.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{p.label}</div>
            <div style={{ fontSize: 10, color: "var(--text-sub)" }}>{p.desc}</div>
          </div>
        </label>
      ))}
      {perms.length === 0 && <div style={{ fontSize: 11, color: "#888", background: "#f5f5f5", borderRadius: 8, padding: "6px 12px" }}>👁 Aucun droit = Lecture seule</div>}
    </div>
  );

  // Invités gérés (emails uniques)
  const uniqueEmails = Object.keys(invitationsByEmail);
  // Événements de l'invité géré (pour les modes selection/all)
  const managerInvs = managerEmail ? invitations.filter(i => i.email === managerEmail) : [];

  return (
    <div>
      {/* ─── Modal Gestionnaire de droits ─── */}
      {managerEmail && (
        <Modal title={`🔐 Droits de ${managerEmail}`} onClose={closeManager}>
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            {/* Sélecteur de mode */}
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Mode d'application</label>
              <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 10, padding: 3, gap: 2, marginTop: 6 }}>
                {[
                  { key: "by_event", label: "Par événement" },
                  { key: "selection", label: "Sélection" },
                  { key: "all", label: "⚠️ Tous" },
                ].map(m => (
                  <button key={m.key} onClick={() => { setManagerMode(m.key); setConfirmAll(false); }}
                    style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "none", background: managerMode === m.key ? (m.key === "all" ? "#C62828" : "#0F0F0F") : "transparent", color: managerMode === m.key ? "#fff" : "var(--text-muted)", fontSize: 11, fontWeight: managerMode === m.key ? 700 : 400, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "all 0.15s" }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode PAR ÉVÉNEMENT */}
            {managerMode === "by_event" && (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 12 }}>Définissez des droits différents pour chaque événement.</div>
                {managerInvs.map(inv => (
                  <div key={inv.event_id} style={{ marginBottom: 16, background: "var(--hover-bg)", borderRadius: 12, padding: "12px 14px", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span>{inv.eventType === "budget" ? "🏦" : "💸"}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{inv.eventName}</span>
                    </div>
                    <PermCheckboxes
                      eventType={inv.eventType}
                      perms={managerPerms[inv.event_id] || []}
                      onToggle={(key) => setManagerPerms(prev => {
                        const cur = prev[inv.event_id] || [];
                        return { ...prev, [inv.event_id]: cur.includes(key) ? cur.filter(p => p !== key) : [...cur, key] };
                      })}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Mode SÉLECTION */}
            {managerMode === "selection" && (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 12 }}>Sélectionnez les événements et appliquez les mêmes droits.</div>
                {/* Choix événements */}
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Événements concernés</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                    {managerInvs.map(inv => (
                      <label key={inv.event_id} onClick={() => setSelectionEvents(prev => prev.includes(inv.event_id) ? prev.filter(x => x !== inv.event_id) : [...prev, inv.event_id])}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 9, border: `1.5px solid ${selectionEvents.includes(inv.event_id) ? "#1565C0" : "var(--border)"}`, background: selectionEvents.includes(inv.event_id) ? "#E3F2FD" : "var(--hover-bg)", cursor: "pointer", transition: "all 0.15s" }}>
                        <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${selectionEvents.includes(inv.event_id) ? "#1565C0" : "#ccc"}`, background: selectionEvents.includes(inv.event_id) ? "#1565C0" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {selectionEvents.includes(inv.event_id) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                        </div>
                        <span>{inv.eventType === "budget" ? "🏦" : "💸"}</span>
                        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: selectionEvents.includes(inv.event_id) ? 700 : 400 }}>{inv.eventName}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {/* Droits à appliquer */}
                {selectionEvents.length > 0 && (
                  <div>
                    <label style={{ ...S.label, marginBottom: 8 }}>Droits à appliquer</label>
                    <PermCheckboxes
                      eventType={managerInvs.find(i => selectionEvents.includes(i.event_id))?.eventType}
                      perms={selectionPerms}
                      onToggle={(key) => togglePerm(selectionPerms, setSelectionPerms, key)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Mode TOUS */}
            {managerMode === "all" && (
              <div>
                <div style={{ background: "#FFEBEE", border: "1px solid #FFCDD2", borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: 12, color: "#C62828" }}>
                  ⚠️ <strong>Attention :</strong> Ces droits s'appliqueront à <strong>TOUS les événements actuels ET futurs</strong> créés par vous auxquels cet invité sera invité.
                </div>
                <PermCheckboxes
                  eventType="split"
                  perms={allPerms}
                  onToggle={(key) => togglePerm(allPerms, setAllPerms, key)}
                />
                {/* Visa fort */}
                <label onClick={() => setConfirmAll(!confirmAll)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: confirmAll ? "#FFEBEE" : "var(--hover-bg)", border: `1.5px solid ${confirmAll ? "#C62828" : "var(--border)"}`, cursor: "pointer", marginTop: 14, transition: "all 0.15s" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${confirmAll ? "#C62828" : "#ccc"}`, background: confirmAll ? "#C62828" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {confirmAll && <span style={{ color: "#fff", fontSize: 11 }}>✓</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: confirmAll ? "#C62828" : "var(--text)" }}>Je confirme appliquer ces droits à tous mes événements</div>
                    <div style={{ fontSize: 11, color: "var(--text-sub)" }}>Cette action affecte les événements existants et futurs</div>
                  </div>
                </label>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={handleSaveManager} disabled={savingPerms || (managerMode === "all" && !confirmAll) || (managerMode === "selection" && selectionEvents.length === 0)}
              style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", background: managerMode === "all" ? "#C62828" : undefined, opacity: (managerMode === "all" && !confirmAll) || (managerMode === "selection" && selectionEvents.length === 0) ? 0.5 : 1 }}>
              {savingPerms ? "..." : "✓ Enregistrer"}
            </button>
            <button onClick={closeManager} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
          </div>
        </Modal>
      )}

      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>Invitations</h2>
      <p style={{ color: "var(--text-sub)", fontSize: 12, marginBottom: 20 }}>Gérez l'accès et les droits de vos invités</p>

      {/* ─── Formulaire invitation ─── */}
      <div style={S.card}>
        <div style={S.sectionTitle}>✉️ Inviter quelqu'un</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={S.label}>Email de l'invité</label>
            <input style={S.input} type="email" placeholder="ami@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
        </div>

        {/* Permissions */}
        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Droits accordés <span style={{ color: "var(--text-sub)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(lecture seule par défaut)</span></label>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
            {Object.entries(ALL_PERMISSIONS).map(([key, p]) => (
              <label key={key} onClick={() => togglePerm(permissions, setPermissions, key)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${permissions.includes(key) ? p.color : "var(--border)"}`, background: permissions.includes(key) ? p.bg : "var(--bg-secondary)", cursor: "pointer", transition: "all 0.15s" }}>
                <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${permissions.includes(key) ? p.color : "#ccc"}`, background: permissions.includes(key) ? p.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {permissions.includes(key) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                </div>
                <span style={{ fontSize: 11 }}>{p.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", flex: 1 }}>{p.label}</span>
              </label>
            ))}
          </div>
          {permissions.length === 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#888", background: "#f5f5f5", borderRadius: 8, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}>
              👁 Aucun droit sélectionné = <strong>Lecture seule</strong>
            </div>
          )}
        </div>

        {/* Événements */}
        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Événements accessibles</label>
          {events.length === 0 ? <div style={{ color: "#aaa", fontSize: 13, padding: "8px 0" }}>Aucun événement créé</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {events.map(ev => (
                <label key={ev.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, padding: "8px 12px", borderRadius: 10, background: selectedEvents.includes(ev.id) ? "#f0faf4" : "var(--hover-bg)", border: `1px solid ${selectedEvents.includes(ev.id) ? "#c8e6c9" : "var(--border)"}`, transition: "all 0.15s" }}>
                  <input type="checkbox" checked={selectedEvents.includes(ev.id)} onChange={() => setSelectedEvents(s => s.includes(ev.id) ? s.filter(x => x !== ev.id) : [...s, ev.id])} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}
                  </span>
                  <span style={{ color: "var(--text-sub)", fontSize: 11, flexShrink: 0 }}>{ev.date}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <button onClick={handleSend} disabled={saving} style={S.btnDark}>{saving ? "Envoi..." : "Envoyer l'invitation ✉️"}</button>
      </div>

      {/* ─── Liste invités groupés par email ─── */}
      <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", marginTop: 16 }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
          Invités ({uniqueEmails.length} personne{uniqueEmails.length > 1 ? "s" : ""} · {invitations.length} invitation{invitations.length > 1 ? "s" : ""})
        </div>
        {uniqueEmails.length === 0 ? (
          <EmptyState icon="👥" title="Aucun invité" subtitle="Invitez des personnes à consulter vos événements." />
        ) : uniqueEmails.map((guestEmail, gi) => {
          const guestInvs = invitationsByEmail[guestEmail];
          const allAccepted = guestInvs.every(i => i.status === "accepted");
          return (
            <div key={guestEmail} style={{ borderBottom: gi < uniqueEmails.length - 1 ? "1px solid var(--border)" : "none" }}>
              {/* En-tête invité */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", flexWrap: "wrap" }}>
                <Avatar name={guestEmail[0]} size={34} />
                <div style={{ flex: 1, minWidth: 100 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{guestEmail}</div>
                  <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 1 }}>{guestInvs.length} événement{guestInvs.length > 1 ? "s" : ""}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: allAccepted ? "#E8F5E9" : "#FFF8E1", color: allAccepted ? "#2E7D32" : "#F57F17", flexShrink: 0 }}>
                  {allAccepted ? "✓ Accepté" : "⏳ En attente"}
                </span>
                <button onClick={() => openManager(guestEmail)}
                  style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 11, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>
                  🔐 Gérer les droits
                </button>
                <button onClick={() => { if (window.confirm(`Retirer ${guestEmail} de tous les événements ?`)) guestInvs.forEach(i => handleRemove(i)); }}
                  style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>
                  Retirer
                </button>
              </div>
              {/* Détail par événement */}
              <div style={{ paddingLeft: isMobile ? 16 : 64, paddingRight: 18, paddingBottom: 12 }}>
                {guestInvs.map(inv => (
                  <div key={inv.event_id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "var(--text-sub)" }}>{inv.eventType === "budget" ? "🏦" : "💸"} <Truncate text={inv.eventName} max={20} /></span>
                    <span style={{ fontSize: 9, color: "#aaa" }}>·</span>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {normalizePerms(inv.permissions).length === 0
                        ? <PermBadge perm="read_only" />
                        : normalizePerms(inv.permissions).map(p => <PermBadge key={p} perm={p} />)
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ─── NOTIFICATIONS ────────────────────────────────────────────
function NotificationsPage({ notifications, events, expenses, pendingActions, user, onMarkAll, onDismiss, reload, isMobile, addToast }) {
  const [saving, setSaving] = useState(null);

  const handleApprove = async (action) => {
    setSaving(action.id);
    if (action.action_type === "request_permissions") {
      const existing = await fetchInvitationPermissions(action.event_id, action.guest_email);
      const currentPerms = normalizePerms(existing.data || []);
      const requested = normalizePerms(action.action_data?.requested || []);
      const newPerms = [...new Set([...currentPerms, ...requested])];
      await updateInvitationPermissions(action.event_id, action.guest_email, newPerms);
      await rejectPendingAction(action.id, user.id);
      addToast(`Droits accordés à ${action.guest_email}.`, "success");
      await reload();
      setSaving(null);
      return;
    }
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
            const isPermRequest = action.action_type === "request_permissions";

            if (isPermRequest) {
              return (
                <div key={action.id} style={{ background: "#FFF8E1", borderRadius: 14, padding: "16px 18px", border: "1.5px solid #FFE082", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 24, flexShrink: 0 }}>🔐</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#F57F17", marginBottom: 6 }}>
                        {action.guest_email} demande des droits sur "{data?.event_name || ev?.name}"
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                        {(data?.requested || []).map(p => {
                          const pInfo = ALL_PERMISSIONS[p];
                          return pInfo ? (
                            <span key={p} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: pInfo.bg, color: pInfo.color, fontWeight: 700 }}>
                              {pInfo.icon} {pInfo.label}
                            </span>
                          ) : null;
                        })}
                      </div>
                      <div style={{ fontSize: 10, color: "#aaa" }}>{new Date(action.created_at).toLocaleString("fr-FR")}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => handleApprove(action)} disabled={saving === action.id}
                      style={{ ...S.btnDark, background: "#2E7D32", padding: "7px 16px", fontSize: 12, flex: 1, justifyContent: "center", display: "flex" }}>
                      {saving === action.id ? "..." : "✓ Accorder les droits"}
                    </button>
                    <button onClick={() => handleReject(action)} disabled={saving === action.id}
                      style={{ padding: "7px 16px", borderRadius: 9, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 12, cursor: "pointer", fontWeight: 700, flex: 1, fontFamily: "inherit" }}>
                      ✗ Refuser
                    </button>
                  </div>
                </div>
              );
            }

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
function SettingsPage({ user, onSignOut, isMobile, addToast, t, events }) {
  const { dark, toggle } = useTheme();
  const { lang, setLang } = useTranslation();
  const [pushEnabled, setPushEnabled] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );
  const [showReport, setShowReport] = useState(false);
  const [reportForm, setReportForm] = useState({ category: "bug", message: "", eventId: "" });
  const [sendingReport, setSendingReport] = useState(false);

  const handleSendReport = async () => {
    if (!reportForm.message.trim()) { addToast("Décrivez le problème.", "warning"); return; }
    setSendingReport(true);
    const { error } = await createReport({
      userId: user.id,
      userEmail: user.email,
      category: reportForm.category,
      message: reportForm.message,
      eventId: reportForm.eventId || null,
    });
    setSendingReport(false);
    if (error) { addToast("Erreur lors de l'envoi.", "error"); return; }
    setShowReport(false);
    setReportForm({ category: "bug", message: "", eventId: "" });
    addToast("✓ Signalement envoyé à l'équipe SplitLy.", "success");
  };

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
        {t ? t("nav_settings") : "Paramètres"}
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

      <Section title="🚨 Signaler un problème">
        {!showReport ? (
          <div style={{ padding: "14px 20px" }}>
            <p style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 12 }}>Un bug, une erreur de données, un problème d'accès ? Signalez-le directement à l'équipe SplitLy.</p>
            <button onClick={() => setShowReport(true)} style={{ ...S.btnGhost, fontSize: 12, padding: "8px 16px" }}>🚨 Ouvrir un signalement</button>
          </div>
        ) : (
          <div style={{ padding: "14px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={S.label}>Catégorie</label>
                <select style={S.input} value={reportForm.category} onChange={e => setReportForm({ ...reportForm, category: e.target.value })}>
                  <option value="bug">🐛 Bug technique</option>
                  <option value="data">📊 Problème de données</option>
                  <option value="access">🔐 Problème d'accès</option>
                  <option value="request">💡 Demande spéciale</option>
                  <option value="other">💬 Autre</option>
                </select>
              </div>
              {events && events.length > 0 && (
                <div>
                  <label style={S.label}>Événement concerné <span style={{ color: "#aaa", fontWeight: 400 }}>(optionnel)</span></label>
                  <select style={S.input} value={reportForm.eventId} onChange={e => setReportForm({ ...reportForm, eventId: e.target.value })}>
                    <option value="">Aucun événement spécifique</option>
                    {events.map(ev => <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={S.label}>Description du problème <span style={{ color: "#C62828" }}>*</span></label>
                <textarea style={{ ...S.input, minHeight: 100, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
                  placeholder="Décrivez le problème en détail : ce que vous faisiez, ce qui s'est passé, le résultat attendu..."
                  value={reportForm.message}
                  onChange={e => setReportForm({ ...reportForm, message: e.target.value })}
                  maxLength={1000} />
                <div style={{ fontSize: 10, color: "var(--text-sub)", textAlign: "right", marginTop: 2 }}>{reportForm.message.length}/1000</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleSendReport} disabled={sendingReport || !reportForm.message.trim()}
                  style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", opacity: !reportForm.message.trim() ? 0.5 : 1 }}>
                  {sendingReport ? "Envoi..." : "✓ Envoyer le signalement"}
                </button>
                <button onClick={() => setShowReport(false)} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
              </div>
            </div>
          </div>
        )}
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
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "users" | "reports"
  const [confirm, setConfirm] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [acting, setActing] = useState(null);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [updatingReport, setUpdatingReport] = useState(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await fetchAdminUsers();
    if (error) { addToast("Erreur chargement : " + error.message, "error"); }
    else setUsers(data || []);
    // Load reports via supabase directly (service key not needed for reads with RLS bypassed via admin)
    try {
      const { data: rData } = await fetchReports();
      setReports(rData || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Métriques ─────────────────────────────────────────────
  const now = new Date();
  const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const newThisWeek = users.filter(u => new Date(u.created_at) > oneWeekAgo).length;
  const newThisMonth = users.filter(u => new Date(u.created_at) > oneMonthAgo).length;
  const activeUsers = users.filter(u => u.user_role === "user").length;
  const blockedUsers = users.filter(u => u.user_role === "blocked").length;
  const activated = users.filter(u => u.events_total > 0).length;
  const activationRate = users.length > 0 ? ((activated / users.length) * 100).toFixed(0) : 0;
  const totalEvents = users.reduce((s, u) => s + (u.events_total || 0), 0);
  const totalBudget = users.reduce((s, u) => s + (u.budget_total || 0), 0);
  const avgEvents = users.length > 0 ? (totalEvents / users.length).toFixed(1) : 0;
  const openReports = reports.filter(r => r.status === "open").length;

  const ADMIN_TABS = [
    { key: "overview",  icon: "📊", label: "Vue d'ensemble" },
    { key: "users",     icon: "👥", label: "Utilisateurs" },
    { key: "reports",   icon: "🚨", label: `Signalements${openReports > 0 ? ` (${openReports})` : ""}` },
  ];

  const reportCategoryLabel = {
    bug: "🐛 Bug technique",
    data: "📊 Données",
    access: "🔐 Accès",
    request: "💡 Demande",
    other: "💬 Autre",
  };

  const handleUpdateReportStatus = async (reportId, status) => {
    setUpdatingReport(reportId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'update_report', userId: user.id, reportId, status }),
      });
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status } : r));
      addToast(`Signalement marqué "${status}".`, "success");
    } catch { addToast("Erreur de mise à jour.", "error"); }
    setUpdatingReport(null);
  };

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

  const handleSendEmail = async () => {
    if (!emailModal || !emailSubject.trim() || !emailBody.trim()) return;
    setSendingEmail(true);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailModal.userEmail,
          subject: emailSubject,
          html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:32px">
            <h2 style="color:#0F0F0F">Message de l'équipe SplitLy</h2>
            <div style="font-size:15px;line-height:1.7;color:#333;white-space:pre-wrap">${emailBody}</div>
            <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
            <p style="font-size:12px;color:#aaa">Cet email a été envoyé depuis le back-office SplitLy.</p>
          </div>`,
        }),
      });
      if (res.ok) {
        addToast(`✉️ Email envoyé à ${emailModal.userEmail}`, "success");
        setEmailModal(null);
        setEmailSubject("");
        setEmailBody("");
      } else {
        addToast("Erreur lors de l'envoi de l'email.", "error");
      }
    } catch {
      addToast("Erreur réseau.", "error");
    }
    setSendingEmail(false);
  };

  // Filtres
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.email?.toLowerCase().includes(q) || u.full_name?.toLowerCase().includes(q);
    const matchRole = filterRole === "all" || u.user_role === filterRole;
    return matchSearch && matchRole;
  });

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
      {emailModal && (
        <Modal title={`✉️ Envoyer un email à ${emailModal.userName}`} onClose={() => { setEmailModal(null); setEmailSubject(""); setEmailBody(""); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.8, display: "block", marginBottom: 6 }}>Destinataire</label>
              <div style={{ fontSize: 13, color: "var(--text)", padding: "8px 12px", background: "var(--hover-bg)", borderRadius: 8, border: "1px solid var(--border)" }}>{emailModal.userEmail}</div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.8, display: "block", marginBottom: 6 }}>Sujet</label>
              <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
                placeholder="Objet de l'email..."
                style={{ ...S.input, width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.8, display: "block", marginBottom: 6 }}>Message</label>
              <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)}
                placeholder="Votre message..."
                rows={6}
                style={{ ...S.input, width: "100%", resize: "vertical", minHeight: 120 }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSendEmail} disabled={sendingEmail || !emailSubject.trim() || !emailBody.trim()}
                style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", opacity: (!emailSubject.trim() || !emailBody.trim()) ? 0.5 : 1 }}>
                {sendingEmail ? "Envoi..." : "✉️ Envoyer"}
              </button>
              <button onClick={() => { setEmailModal(null); setEmailSubject(""); setEmailBody(""); }}
                style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
            </div>
          </div>
        </Modal>
      )}

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 4, color: "var(--text)", display: "flex", alignItems: "center", gap: 10 }}>
            ⚡ Super Admin
            <span style={{ background: "#FFF8E1", color: "#F57F17", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid #FFE08244" }}>Back-office</span>
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>Administration SplitLy</p>
        </div>
        <button onClick={load} style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }}>↻ Actualiser</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 12, padding: 3, gap: 2, marginBottom: 24, flexWrap: "wrap" }}>
        {ADMIN_TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 9, border: "none", background: activeTab === tab.key ? "#0F0F0F" : "transparent", color: activeTab === tab.key ? "#fff" : "var(--text-muted)", fontSize: 12, fontWeight: activeTab === tab.key ? 700 : 400, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* ── VUE D'ENSEMBLE ── */}
      {activeTab === "overview" && (
        <div>
          {/* KPIs globaux */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Utilisateurs total", value: users.length, sub: `+${newThisWeek} cette semaine`, accent: "#0F0F0F" },
              { label: "Taux activation", value: `${activationRate}%`, sub: `${activated} avec événements`, accent: "#2E7D32" },
              { label: "Budget plateforme", value: `${(totalBudget / 1000).toFixed(1)}k`, sub: "toutes devises", accent: "#6A1B9A" },
              { label: "Signalements ouverts", value: openReports, sub: `${reports.length} total`, accent: openReports > 0 ? "#C62828" : "#2E7D32" },
            ].map(k => (
              <div key={k.label} style={{ background: "var(--bg-secondary)", borderRadius: 14, padding: "16px 18px", border: `1px solid var(--border)`, borderLeft: `4px solid ${k.accent}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Playfair Display', serif", color: "var(--text)" }}>{k.value}</div>
                <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 3 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Stats détaillées */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>👥 Utilisateurs</div>
              {[
                { label: "Nouveaux (7j)", value: newThisWeek, color: "#2E7D32" },
                { label: "Nouveaux (30j)", value: newThisMonth, color: "#1565C0" },
                { label: "Actifs", value: activeUsers, color: "#2E7D32" },
                { label: "Bloqués", value: blockedUsers, color: "#C62828" },
                { label: "Taux activation", value: `${activationRate}%`, color: "#F57F17" },
              ].map(s => (
                <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>{s.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</span>
                </div>
              ))}
            </div>
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>📊 Plateforme</div>
              {[
                { label: "Total événements", value: totalEvents, color: "#1565C0" },
                { label: "Moy. événements/user", value: avgEvents, color: "#F57F17" },
                { label: "Budget total géré", value: `${(totalBudget / 1000).toFixed(1)}k`, color: "#6A1B9A" },
                { label: "Signalements ouverts", value: openReports, color: openReports > 0 ? "#C62828" : "#2E7D32" },
                { label: "Signalements total", value: reports.length, color: "#888" },
              ].map(s => (
                <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>{s.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── UTILISATEURS ── */}
      {activeTab === "users" && (
      <div>
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
                  <button onClick={() => setEmailModal({ userId: u.id, userEmail: u.email, userName: u.full_name !== "—" ? u.full_name : u.email })}
                    style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
                    ✉️
                  </button>
                  <button onClick={() => setConfirm({ action: "delete", userId: u.id, userName: u.email })}
                    style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #FFCDD2", background: "#FFEBEE", color: "#C62828", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
                    🗑
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
                          <button onClick={() => setEmailModal({ userId: u.id, userEmail: u.email, userName: u.full_name !== "—" ? u.full_name : u.email })} disabled={acting === u.id}
                            style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                            ✉️
                          </button>
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
      )} {/* fin onglet users */}

      {/* ── SIGNALEMENTS ── */}
      {activeTab === "reports" && (
        <div>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-sub)" }}>Chargement...</div>
          ) : reports.length === 0 ? (
            <EmptyState icon="✅" title="Aucun signalement" subtitle="Aucun utilisateur n'a signalé de problème." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {reports.map(r => {
                const statusColor = r.status === "open" ? "#C62828" : r.status === "resolved" ? "#2E7D32" : "#888";
                const statusBg = r.status === "open" ? "#FFEBEE" : r.status === "resolved" ? "#E8F5E9" : "#f5f5f5";
                const statusLabel = r.status === "open" ? "🔴 Ouvert" : r.status === "resolved" ? "✅ Résolu" : "📦 Archivé";
                return (
                  <div key={r.id} style={{ background: "var(--bg-secondary)", borderRadius: 14, border: `1px solid ${r.status === "open" ? "#FFCDD2" : "var(--border)"}`, padding: "16px 18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.user_email}</span>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "#E3F2FD", color: "#1565C0", fontWeight: 700, flexShrink: 0 }}>{reportCategoryLabel[r.category] || r.category}</span>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: statusBg, color: statusColor, fontWeight: 700, flexShrink: 0 }}>{statusLabel}</span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-sub)", flexShrink: 0 }}>{new Date(r.created_at).toLocaleDateString("fr-FR")}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, marginBottom: 12 }}>{r.message}</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {r.status === "open" && (
                        <button onClick={() => handleUpdateReportStatus(r.id, "resolved")} disabled={updatingReport === r.id}
                          style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #c8e6c9", background: "#E8F5E9", color: "#2E7D32", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                          ✅ Marquer résolu
                        </button>
                      )}
                      {r.status !== "archived" && (
                        <button onClick={() => handleUpdateReportStatus(r.id, "archived")} disabled={updatingReport === r.id}
                          style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--hover-bg)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
                          📦 Archiver
                        </button>
                      )}
                      <button onClick={() => setEmailModal({ userId: r.user_id, userEmail: r.user_email, userName: r.user_email })}
                        style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                        ✉️ Répondre par email
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TEMPLATE PDF UNIFIÉ ─────────────────────────────────────
function buildPDF({ title, subtitle, docType, meta = [], summaryItems = [], sections = [], printAuto = true }) {
  const now = new Date().toLocaleString('fr-FR');
  const dateOnly = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const metaHTML = meta.map(m => `
    <div class="meta-item">
      <div>${m.label}</div>
      <div class="meta-value">${m.value}</div>
    </div>`).join('');

  const summaryHTML = summaryItems.map(s => `
    <div class="summary-item" style="${s.accent ? `border-top: 3px solid ${s.accent}` : ''}">
      <div class="summary-label">${s.label}</div>
      <div class="summary-value" style="${s.color ? `color:${s.color}` : ''}">${s.value}</div>
      ${s.sub ? `<div class="summary-sub">${s.sub}</div>` : ''}
    </div>`).join('');

  const sectionsHTML = sections.map(s => `
    <div class="section">
      <div class="section-title">${s.title}</div>
      ${s.content}
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>SplitLy — ${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', Arial, sans-serif; color: #1a1a1a; background: #fff; }
    .header { background: linear-gradient(135deg, #0F0F0F 0%, #1a1a2e 100%); color: #fff; padding: 36px 40px 28px; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .logo { font-size: 28px; font-weight: 800; letter-spacing: -1px; }
    .doc-type { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 6px; }
    .event-name { font-size: 22px; font-weight: 700; }
    .header-sub { font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 4px; }
    .header-meta { display: flex; gap: 24px; flex-wrap: wrap; }
    .meta-item { font-size: 12px; color: rgba(255,255,255,0.6); }
    .meta-value { font-size: 14px; font-weight: 600; color: #fff; margin-top: 2px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0; border-bottom: 2px solid #f0f0f0; }
    .summary-item { padding: 20px 24px; border-right: 1px solid #f0f0f0; }
    .summary-item:last-child { border-right: none; }
    .summary-label { font-size: 10px; font-weight: 700; color: #aaa; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .summary-value { font-size: 20px; font-weight: 800; color: #0F0F0F; }
    .summary-sub { font-size: 11px; color: #aaa; margin-top: 3px; }
    .section { padding: 28px 40px; border-bottom: 1px solid #f5f5f5; }
    .section-title { font-size: 13px; font-weight: 700; color: #0F0F0F; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    .section-title::before { content: ''; display: inline-block; width: 4px; height: 16px; background: #0F0F0F; border-radius: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    thead tr { background: #0F0F0F; color: #fff; }
    thead th { padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }
    tbody tr:nth-child(even) { background: #f9f9f9; }
    tfoot tr { background: #f0f0f0; font-weight: 700; }
    tfoot td { padding: 10px 12px; }
    .cat-bar { margin-bottom: 10px; }
    .cat-bar-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 12px; }
    .cat-bar-track { background: #eee; height: 6px; border-radius: 3px; overflow: hidden; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 700; }
    .info-box { background: #FFF8E1; border: 1px solid #FFE082; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #E65100; margin-bottom: 16px; }
    .footer { padding: 20px 40px; background: #f9f9f9; display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #f0f0f0; }
    .footer-logo { font-size: 15px; font-weight: 800; color: #0F0F0F; }
    .footer-text { font-size: 10px; color: #aaa; text-align: right; line-height: 1.6; }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div>
        <div class="doc-type">${docType}</div>
        <div class="event-name">${title}</div>
        ${subtitle ? `<div class="header-sub">${subtitle}</div>` : ''}
      </div>
      <div class="logo">SplitLy</div>
    </div>
    <div class="header-meta">${metaHTML}</div>
  </div>
  ${summaryItems.length > 0 ? `<div class="summary">${summaryHTML}</div>` : ''}
  ${sectionsHTML}
  <div class="footer">
    <div>
      <div class="footer-logo">SplitLy</div>
      <div style="font-size:10px;color:#aaa;margin-top:2px">Gestion de dépenses partagées · splitmeapp.com</div>
    </div>
    <div class="footer-text">
      <div>Document généré le ${now}</div>
      <div>Document non contractuel — Référence au ${dateOnly}</div>
    </div>
  </div>
  ${printAuto ? '<script>window.onload = () => setTimeout(() => window.print(), 600);</script>' : ''}
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// ─── EXPORT PDF COTISATIONS ───────────────────────────────────
function exportCotisationsPDF(ev, cotisations) {
  const sym = currencySymbol(ev.currency);
  const fmt2 = n => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
  const totalCollecte = cotisations.filter(c => c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const totalNature = cotisations.filter(c => c.forme === "nature").reduce((s, c) => s + c.montant, 0);
  const totalEspeces = cotisations.filter(c => c.forme === "especes" && c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const participants = (ev.event_participants || []).map(p => p.name);
  const cotisants = new Set(cotisations.filter(c => c.statut === "paye").map(c => c.participant_name));
  const nonCotisants = participants.filter(p => !cotisants.has(p));

  const rows = cotisations.map((c, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'}">
      <td style="padding:9px 12px;font-weight:600">${c.participant_name}</td>
      <td style="padding:9px 12px"><span class="badge" style="background:${c.forme === "nature" ? "#E8F5E9" : "#E3F2FD"};color:${c.forme === "nature" ? "#2E7D32" : "#1565C0"}">${c.forme === "nature" ? "🌿 Nature" : "💵 Espèces"}</span></td>
      <td style="padding:9px 12px"><span class="badge" style="background:${c.statut === "paye" ? "#E8F5E9" : c.statut === "partiel" ? "#FFF8E1" : "#FFEBEE"};color:${c.statut === "paye" ? "#2E7D32" : c.statut === "partiel" ? "#F57F17" : "#C62828"}">${c.statut === "paye" ? "✓ Payé" : c.statut === "partiel" ? "~ Partiel" : "✗ Impayé"}</span></td>
      <td style="padding:9px 12px;color:#888;font-size:11px">${c.description || "—"}</td>
      <td style="padding:9px 12px;text-align:right;font-weight:700">${fmt2(c.montant)}</td>
    </tr>`).join('');

  const catBars = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="cat-bar"><div class="cat-bar-label"><span>💵 Espèces</span><strong>${fmt2(totalEspeces)}</strong></div><div class="cat-bar-track"><div style="background:#1565C0;height:6px;width:${totalCollecte > 0 ? (totalEspeces / totalCollecte) * 100 : 0}%;border-radius:3px"></div></div></div>
      <div class="cat-bar"><div class="cat-bar-label"><span>🌿 Nature</span><strong>${fmt2(totalNature)}</strong></div><div class="cat-bar-track"><div style="background:#2E7D32;height:6px;width:${totalCollecte > 0 ? (totalNature / totalCollecte) * 100 : 0}%;border-radius:3px"></div></div></div>
    </div>`;

  buildPDF({
    title: ev.name,
    subtitle: "Bilan des cotisations",
    docType: "Rapport Cotisations · Événement Budget",
    meta: [
      { label: "Date de l'événement", value: ev.date },
      { label: "Participants", value: `${participants.length} personne${participants.length > 1 ? 's' : ''}` },
      { label: "Devise", value: sym },
      { label: "Cotisation cible", value: ev.cotisation_cible > 0 ? fmt2(ev.cotisation_cible) + '/p.' : 'Libre' },
    ],
    summaryItems: [
      { label: "Total collecté", value: fmt2(totalCollecte), sub: `${cotisants.size} cotisant(s)`, accent: "#2E7D32", color: "#2E7D32" },
      { label: "En espèces", value: fmt2(totalEspeces), sub: "virements + cash", accent: "#1565C0" },
      { label: "En nature", value: fmt2(totalNature), sub: "valorisation", accent: "#6A1B9A" },
      { label: "Taux collecte", value: ev.cotisation_cible > 0 ? `${((totalCollecte / (ev.cotisation_cible * participants.length)) * 100).toFixed(0)}%` : `${cotisants.size}/${participants.length}`, sub: ev.cotisation_cible > 0 ? `objectif ${fmt2(ev.cotisation_cible * participants.length)}` : "participants" },
    ],
    sections: [
      { title: "Répartition par forme", content: catBars },
      {
        title: `Détail des cotisations (${cotisations.length})`,
        content: `<table>
          <thead><tr><th>Participant</th><th>Forme</th><th>Statut</th><th>Description</th><th style="text-align:right">Montant</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="4">TOTAL COLLECTÉ</td><td style="text-align:right;color:#2E7D32">${fmt2(totalCollecte)}</td></tr></tfoot>
        </table>`
      },
      nonCotisants.length > 0
        ? { title: "Participants sans cotisation", content: `<div style="background:#FFEBEE;border:1px solid #FFCDD2;border-radius:8px;padding:12px 16px;color:#C62828;font-size:13px">⚠️ ${nonCotisants.length} participant(s) n'ont pas encore cotisé : <strong>${nonCotisants.join(', ')}</strong></div>` }
        : { title: "Statut général", content: `<div style="background:#E8F5E9;border:1px solid #C8E6C9;border-radius:8px;padding:12px 16px;color:#2E7D32;font-size:13px">✓ Tous les participants ont cotisé.</div>` }
    ],
  });
}
// ─── CONTRIBUTIONS PAGE (fusion Balance + Cotisations) ────────
function ContributionsPage({ events, expenses, contributions, user, reload, isMobile, addToast, t }) {
  const [filterEvent, setFilterEvent] = useState(events[0]?.id || "");
  const [cotisations, setCotisations] = useState([]);
  const ev = events.find(e => e.id === filterEvent);
  const isBudget = ev?.event_type === "budget";

  useEffect(() => {
    if (isBudget && filterEvent) {
      fetchCotisations(filterEvent).then(({ data }) => setCotisations(data || []));
    }
  }, [filterEvent, isBudget]);

  return (
    <div>
      {/* Sélecteur événement */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2, color: "var(--text)" }}>
            {isBudget ? "💰 Cotisations" : "⊜ Répartition"}
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>
            {isBudget ? "Gestion des cotisations et contributions" : "Soldes calculés en temps réel"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}</option>)}
          </select>
          {isBudget && (
            <button onClick={() => exportCotisationsPDF(ev, cotisations)}
              style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px", whiteSpace: "nowrap" }}>
              📄 PDF Cotisations
            </button>
          )}
        </div>
      </div>

      {/* Routing selon le type */}
      {isBudget ? (
        <CotisationsPage
          events={events.filter(e => e.id === filterEvent)}
          expenses={expenses}
          user={user}
          reload={async () => {
            await reload();
            const { data } = await fetchCotisations(filterEvent);
            setCotisations(data || []);
          }}
          isMobile={isMobile}
          addToast={addToast}
          t={t}
          hideHeader={true}
        />
      ) : (
        <Balance
          events={events}
          expenses={expenses}
          contributions={contributions}
          user={user}
          reload={reload}
          isMobile={isMobile}
          addToast={addToast}
          t={t}
          initialEvent={filterEvent}
          hideHeader={true}
        />
      )}
    </div>
  );
}

// ─── COTISATIONS PAGE (Phase 4a) ──────────────────────────────
function CotisationsPage({ events, expenses, user, reload, isMobile, addToast, t, hideHeader }) {
  const budgetEvents = events.filter(e => e.event_type === "budget" && e.status === "open");
  const [filterEvent, setFilterEvent] = useState(budgetEvents[0]?.id || "");
  const ev = events.find(e => e.id === filterEvent);
  const sym = currencySymbol(ev?.currency);
  const participants = (ev?.event_participants || []).map(p => p.name);
  const cotisationCible = ev?.cotisation_cible || 0;

  const [cotisations, setCotisations] = useState([]);
  const [loadingCot, setLoadingCot] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingCot, setEditingCot] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipant, setNewParticipant] = useState("");

  // B3 — Inscription groupée
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupSelected, setGroupSelected] = useState([]);
  const [savingGroup, setSavingGroup] = useState(false);

  // B2 — Mode montant : "minimal" | "libre"
  const [montantMode, setMontantMode] = useState(cotisationCible > 0 ? "minimal" : "libre");

  // Formulaire cotisation (B1: statut supprimé)
  const emptyForm = { participant_name: "", montant: "", forme: "especes", description: "" };
  const [form, setForm] = useState(emptyForm);

  // Formulaire charge en nature
  const emptyNatureForm = { category: "Divers", sub: "", detail: "", qty: 1, unit: "", comment: "" };
  const [natureForm, setNatureForm] = useState(emptyNatureForm);

  // Recalculer montantMode quand l'événement change
  useEffect(() => {
    setMontantMode(cotisationCible > 0 ? "minimal" : "libre");
    setGroupSelected([]);
  }, [filterEvent, cotisationCible]);

  // Charger cotisations
  const loadCotisations = async () => {
    if (!filterEvent) return;
    setLoadingCot(true);
    try {
      const { data } = await fetchCotisations(filterEvent);
      setCotisations(data || []);
    } catch { setCotisations([]); }
    setLoadingCot(false);
  };

  useEffect(() => { loadCotisations(); }, [filterEvent]);

  // B1: Statut automatique selon montant
  const computeStatut = (montant) => Number(montant) > 0 ? "paye" : "impaye";

  // B2: Montant effectif selon mode
  const getMontantEffectif = () => {
    if (montantMode === "minimal" && cotisationCible > 0) return cotisationCible;
    return Number(form.montant) || 0;
  };

  const handleSave = async () => {
    if (!form.participant_name.trim()) { addToast("Sélectionnez un participant.", "warning"); return; }
    const montantEffectif = getMontantEffectif();
    if (!montantEffectif || montantEffectif <= 0) { addToast("Le montant doit être supérieur à 0.", "warning"); return; }
    // B2: Validation montant libre >= cible si cible définie
    if (montantMode === "libre" && cotisationCible > 0 && montantEffectif < cotisationCible) {
      addToast(`Le montant doit être au moins égal à la cotisation cible (${fmt(cotisationCible, sym)}).`, "warning"); return;
    }
    if (form.participant_name.length > 30) { addToast("Nom trop long (max 30 car.).", "warning"); return; }
    if (form.forme === "nature" && !natureForm.detail.trim()) { addToast("Précisez la nature de l'apport.", "warning"); return; }

    setSaving(true);
    const cotData = {
      event_id: filterEvent,
      participant_name: form.participant_name,
      montant: montantEffectif,
      forme: form.forme,
      statut: computeStatut(montantEffectif), // B1: automatique
      description: form.description,
    };

    try {
      if (editingCot) {
        await updateCotisation(editingCot.id, cotData);
        addToast("Cotisation mise à jour.", "success");
      } else {
        const { data: newCot } = await createCotisation(cotData);
        if (form.forme === "nature" && newCot) {
          await createExpense({
            eventId: filterEvent,
            category: natureForm.category,
            sub: natureForm.sub || form.participant_name,
            detail: natureForm.detail,
            qty: Number(natureForm.qty) || 1,
            unit: montantEffectif,
            paidBy: form.participant_name,
            included: participants,
            comment: `Apport en nature — cotisation de ${form.participant_name}`,
            is_unpaid: false,
          }, user.id);
        }
        addToast(`Cotisation de ${form.participant_name} enregistrée !`, "success");
      }
      await loadCotisations();
      await reload();
      setShowForm(false);
      setEditingCot(null);
      setForm(emptyForm);
      setNatureForm(emptyNatureForm);
      setMontantMode(cotisationCible > 0 ? "minimal" : "libre");
    } catch (e) {
      addToast("Erreur : " + e.message, "error");
    }
    setSaving(false);
  };

  // B3: Inscription groupée
  const handleSaveGroup = async () => {
    if (groupSelected.length === 0) { addToast("Sélectionnez au moins un participant.", "warning"); return; }
    if (cotisationCible <= 0) { addToast("La cotisation cible doit être définie.", "warning"); return; }
    setSavingGroup(true);
    try {
      for (const name of groupSelected) {
        await createCotisation({
          event_id: filterEvent,
          participant_name: name,
          montant: cotisationCible,
          forme: "especes",
          statut: "paye", // B1: montant > 0 → paye
          description: `Cotisation minimale groupée`,
        });
      }
      await loadCotisations();
      await reload();
      setShowGroupForm(false);
      setGroupSelected([]);
      addToast(`${groupSelected.length} cotisation(s) enregistrée(s) !`, "success");
    } catch (e) {
      addToast("Erreur : " + e.message, "error");
    }
    setSavingGroup(false);
  };

  const handleDelete = (cot) => {
    setConfirm({
      message: `Supprimer la cotisation de ${cot.participant_name} (${fmt(cot.montant, sym)}) ?`,
      onConfirm: async () => {
        await deleteCotisation(cot.id);
        await loadCotisations();
        setConfirm(null);
        addToast("Cotisation supprimée.", "info");
      },
      onCancel: () => setConfirm(null),
    });
  };

  const handleAddParticipant = async () => {
    if (!newParticipant.trim()) return;
    if (newParticipant.trim().length > 30) { addToast("Nom trop long (max 30 car.).", "warning"); return; }
    if (participants.includes(newParticipant.trim())) { addToast("Ce participant existe déjà.", "warning"); return; }
    await addParticipant(filterEvent, newParticipant.trim());
    await reload();
    setNewParticipant("");
    setShowAddParticipant(false);
    addToast(`${newParticipant.trim()} ajouté.`, "success");
  };

  // Stats
  const totalCollecte = cotisations.filter(c => c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const totalEspeces = cotisations.filter(c => c.forme === "especes" && c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const totalNature = cotisations.filter(c => c.forme === "nature").reduce((s, c) => s + c.montant, 0);
  const cible = ev?.cotisation_cible > 0 ? ev.cotisation_cible * participants.length : 0;
  const pctCollecte = cible > 0 ? Math.min((totalCollecte / cible) * 100, 100) : 0;

  // Participants sans cotisation
  const participantsAvecCot = new Set(cotisations.map(c => c.participant_name));
  const participantsSansCot = participants.filter(p => !participantsAvecCot.has(p));

  const formeBadge = (forme) => forme === "nature"
    ? { bg: "#E8F5E9", color: "#2E7D32", label: "🌿 Nature" }
    : { bg: "#E3F2FD", color: "#1565C0", label: "💵 Espèces" };

  const statutBadge = (statut) => ({
    paye:    { bg: "#E8F5E9", color: "#2E7D32",  label: "✓ Payé" },
    partiel: { bg: "#FFF8E1", color: "#F57F17",  label: "~ Partiel" },
    impaye:  { bg: "#FFEBEE", color: "#C62828",  label: "✗ Impayé" },
  })[statut] || { bg: "#f5f5f5", color: "#888", label: statut };

  if (budgetEvents.length === 0) return (
    <div>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>💰 Cotisations</h2>
      <p style={{ color: "var(--text-sub)", fontSize: 12, marginBottom: 20 }}>Gestion des cotisations et contributions</p>
      <EmptyState icon="🏦" title="Aucun événement Budget ouvert"
        subtitle="Créez un événement de type Budget pour gérer les cotisations." />
    </div>
  );

  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2, color: "var(--text)" }}>💰 Cotisations</h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>Gestion des cotisations et contributions</p>
        </div>
        <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => { setFilterEvent(e.target.value); setShowForm(false); setShowGroupForm(false); }}>
          {budgetEvents.map(ev => <option key={ev.id} value={ev.id}>🏦 {ev.name}</option>)}
        </select>
      </div>

      {/* Info */}
      <div style={{ background: "#E3F2FD", border: "1px solid #BBDEFB", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "#1565C0" }}>
        ℹ️ Les cotisations sont liées aux participants enregistrés. <strong>Ajoutez d'abord un participant</strong> pour créer sa cotisation.
        {cotisationCible > 0 && <span> · Cotisation cible : <strong>{fmt(cotisationCible, sym)}</strong>/participant.</span>}
      </div>

      {/* KPIs */}
      {ev && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          <StatCard label="Total collecté" value={fmt(totalCollecte, sym)} sub={`${cotisations.filter(c => c.statut === "paye").length} cotisation(s)`} accent="#2E7D32" />
          <StatCard label="En espèces" value={fmt(totalEspeces, sym)} sub="virements + cash" accent="#1565C0" />
          <StatCard label="En nature" value={fmt(totalNature, sym)} sub="valorisation" accent="#6A1B9A" />
          <StatCard label="Cotisation cible" value={ev.cotisation_cible > 0 ? fmt(cible, sym) : "Libre"} sub={ev.cotisation_cible > 0 ? `${fmt(ev.cotisation_cible, sym)}/pers.` : "montant libre"} accent="#F57F17" />
        </div>
      )}

      {/* Barre de progression collecte */}
      {cible > 0 && (
        <div style={{ background: "var(--bg-secondary)", borderRadius: 12, padding: "14px 18px", marginBottom: 16, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Progression collecte</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: pctCollecte >= 100 ? "#2E7D32" : "#F57F17" }}>{fmt(totalCollecte, sym)} / {fmt(cible, sym)} ({pctCollecte.toFixed(0)}%)</span>
          </div>
          <div style={{ background: "var(--border)", borderRadius: 6, height: 8, overflow: "hidden" }}>
            <div style={{ background: pctCollecte >= 100 ? "#2E7D32" : "#F57F17", height: 8, width: `${pctCollecte}%`, borderRadius: 6, transition: "width 0.5s" }} />
          </div>
        </div>
      )}

      {/* Boutons d'action */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => { setShowForm(!showForm); setShowGroupForm(false); setEditingCot(null); setForm(emptyForm); setMontantMode(cotisationCible > 0 ? "minimal" : "libre"); }}
          style={S.btnDark}>
          {showForm ? "× Fermer" : "+ Ajouter"}
        </button>
        {/* B3: Inscription groupée — uniquement si cible définie */}
        {cotisationCible > 0 && !showForm && (
          <button onClick={() => { setShowGroupForm(!showGroupForm); setGroupSelected([]); }}
            style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }}>
            {showGroupForm ? "× Fermer" : `👥 Inscrire en groupe (${fmt(cotisationCible, sym)})`}
          </button>
        )}
      </div>

      {/* B3 — Formulaire inscription groupée */}
      {showGroupForm && cotisationCible > 0 && (
        <div style={{ ...S.card, marginBottom: 16, border: "1.5px solid #2E7D32" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>👥 Inscription groupée</div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 14 }}>
            Enregistre le montant minimal de <strong>{fmt(cotisationCible, sym)}</strong> pour chaque participant sélectionné (espèces).
          </div>
          {/* Participants sans cotisation uniquement */}
          {(() => {
            const dejaCotisants = new Set(cotisations.map(c => c.participant_name));
            const disponibles = participants.filter(p => !dejaCotisants.has(p));
            if (disponibles.length === 0) return (
              <div style={{ fontSize: 13, color: "#2E7D32", background: "#E8F5E9", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
                ✓ Tous les participants ont déjà une cotisation enregistrée.
              </div>
            );
            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <label style={S.label}>Sélectionner les participants ({groupSelected.length}/{disponibles.length})</label>
                  <button onClick={() => setGroupSelected(groupSelected.length === disponibles.length ? [] : disponibles)}
                    style={{ fontSize: 11, color: "#1565C0", background: "none", border: "none", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                    {groupSelected.length === disponibles.length ? "Tout désélectionner" : "Tout sélectionner"}
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14, maxHeight: 200, overflowY: "auto" }}>
                  {disponibles.map(p => (
                    <label key={p} onClick={() => setGroupSelected(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 9, border: `1.5px solid ${groupSelected.includes(p) ? "#2E7D32" : "var(--border)"}`, background: groupSelected.includes(p) ? "#E8F5E9" : "var(--hover-bg)", cursor: "pointer", transition: "all 0.15s" }}>
                      <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${groupSelected.includes(p) ? "#2E7D32" : "#ccc"}`, background: groupSelected.includes(p) ? "#2E7D32" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {groupSelected.includes(p) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 13, color: "var(--text)", fontWeight: groupSelected.includes(p) ? 700 : 400 }}>{p}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "#2E7D32" }}>{fmt(cotisationCible, sym)}</span>
                    </label>
                  ))}
                </div>
              </>
            );
          })()}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSaveGroup} disabled={savingGroup || groupSelected.length === 0}
              style={{ ...S.btnDark, background: "#2E7D32", flex: 1, justifyContent: "center", display: "flex", opacity: groupSelected.length === 0 ? 0.5 : 1 }}>
              {savingGroup ? "Enregistrement..." : `✓ Enregistrer ${groupSelected.length > 0 ? `(${groupSelected.length} pers.)` : ""}`}
            </button>
            <button onClick={() => { setShowGroupForm(false); setGroupSelected([]); }} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
          </div>
        </div>
      )}

      {/* Formulaire ajout/modif individuel */}
      {showForm && (
        <div style={{ ...S.card, marginBottom: 16, border: editingCot ? "1.5px solid #F57F17" : "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>{editingCot ? "✏️ Modifier la cotisation" : "➕ Nouvelle cotisation"}</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={S.label}>Participant <span style={{ color: "#C62828" }}>*</span></label>
              {editingCot ? (
                <input style={{ ...S.input, background: "var(--hover-bg)" }} value={form.participant_name} disabled />
              ) : (
                <select style={S.input} value={form.participant_name} onChange={e => setForm({ ...form, participant_name: e.target.value })}>
                  <option value="">Sélectionner...</option>
                  {participants.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
            </div>

            {/* B2 — Montant intelligent */}
            <div>
              <label style={S.label}>Montant ({sym}) <span style={{ color: "#C62828" }}>*</span></label>
              {cotisationCible > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Boutons mode */}
                  <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 9, padding: 3, gap: 2 }}>
                    <button onClick={() => setMontantMode("minimal")}
                      style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: "none", background: montantMode === "minimal" ? "#2E7D32" : "transparent", color: montantMode === "minimal" ? "#fff" : "var(--text-muted)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      ✓ Minimal ({fmt(cotisationCible, sym)})
                    </button>
                    <button onClick={() => setMontantMode("libre")}
                      style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: "none", background: montantMode === "libre" ? "#1565C0" : "transparent", color: montantMode === "libre" ? "#fff" : "var(--text-muted)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      Autre montant
                    </button>
                  </div>
                  {/* Champ libre uniquement si mode libre */}
                  {montantMode === "libre" && (
                    <div>
                      <input type="number" min={cotisationCible} step="0.01" style={{ ...S.input, borderColor: (Number(form.montant) > 0 && Number(form.montant) < cotisationCible) ? "#C62828" : undefined }}
                        placeholder={`Min. ${fmt(cotisationCible, sym)}`}
                        value={form.montant}
                        onChange={e => setForm({ ...form, montant: e.target.value })} />
                      {Number(form.montant) > 0 && Number(form.montant) < cotisationCible && (
                        <div style={{ fontSize: 11, color: "#C62828", marginTop: 3 }}>⚠️ Doit être ≥ {fmt(cotisationCible, sym)}</div>
                      )}
                    </div>
                  )}
                  {montantMode === "minimal" && (
                    <div style={{ fontSize: 12, color: "#2E7D32", fontWeight: 700, padding: "8px 12px", background: "#E8F5E9", borderRadius: 8 }}>
                      Montant : {fmt(cotisationCible, sym)}
                    </div>
                  )}
                </div>
              ) : (
                <input type="number" min="0.01" step="0.01" style={S.input} placeholder="Ex: 50" value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} />
              )}
            </div>

            <div>
              <label style={S.label}>Forme</label>
              <select style={S.input} value={form.forme} onChange={e => setForm({ ...form, forme: e.target.value })}>
                <option value="especes">💵 Espèces (cash / virement)</option>
                <option value="nature">🌿 En nature (bien ou service)</option>
              </select>
            </div>

            {/* B1 — Statut automatique affiché mais non modifiable */}
            <div>
              <label style={S.label}>Statut (automatique)</label>
              <div style={{ ...S.input, background: "var(--hover-bg)", display: "flex", alignItems: "center", gap: 8, color: "var(--text-sub)", fontSize: 13 }}>
                <span style={{ fontSize: 14 }}>{getMontantEffectif() > 0 ? "✅" : "❌"}</span>
                {getMontantEffectif() > 0 ? "Payé automatiquement" : "Impayé (montant = 0)"}
              </div>
            </div>

            <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
              <label style={S.label}>Description <span style={{ color: "#aaa", fontWeight: 400 }}>(optionnel)</span></label>
              <input style={S.input} placeholder="Ex: Virement du 12/05" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>

          {/* Champs charge nature */}
          {form.forme === "nature" && !editingCot && (
            <div style={{ background: "#E8F5E9", border: "1px solid #C8E6C9", borderRadius: 10, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#2E7D32", marginBottom: 12 }}>🌿 Détail de l'apport en nature</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={S.label}>Catégorie</label>
                  <select style={S.input} value={natureForm.category} onChange={e => setNatureForm({ ...natureForm, category: e.target.value })}>
                    {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{CATEGORIES[c].icon} {c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Désignation <span style={{ color: "#C62828" }}>*</span></label>
                  <input style={S.input} placeholder="Ex: Nettoyage de la salle" value={natureForm.detail} onChange={e => setNatureForm({ ...natureForm, detail: e.target.value })} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#2E7D32", marginTop: 8 }}>ℹ️ Une charge sera automatiquement créée dans l'onglet Charges avec le montant saisi.</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={{ ...S.btnDark, opacity: saving ? 0.6 : 1 }}>{saving ? "..." : editingCot ? "Modifier" : "Enregistrer"}</button>
            <button onClick={() => { setShowForm(false); setEditingCot(null); setForm(emptyForm); }} style={S.btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Alerte participants sans cotisation */}
      {participantsSansCot.length > 0 && (
        <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: "#F57F17" }}>⚠️ {participantsSansCot.length} participant(s) sans cotisation : </span>
          <span style={{ color: "#E65100" }}>{participantsSansCot.join(", ")}</span>
        </div>
      )}

      {/* Ajouter participant */}
      <div style={{ marginBottom: 16 }}>
        {!showAddParticipant ? (
          <button onClick={() => setShowAddParticipant(true)} style={{ ...S.btnGhost, fontSize: 12, padding: "7px 14px" }}>
            👤 + Ajouter un participant
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <input style={{ ...S.input, borderColor: newParticipant.length > 30 ? "#C62828" : undefined }}
                placeholder="Prénom du participant (max 30 car.)"
                value={newParticipant}
                onChange={e => setNewParticipant(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddParticipant()}
                maxLength={35} />
              {newParticipant.length > 30 && <div style={{ fontSize: 11, color: "#C62828", marginTop: 4 }}>⚠️ Max 30 caractères ({newParticipant.length}/30)</div>}
            </div>
            <button onClick={handleAddParticipant} style={S.btnDark}>+ Ajouter</button>
            <button onClick={() => { setShowAddParticipant(false); setNewParticipant(""); }} style={S.btnGhost}>Annuler</button>
          </div>
        )}
      </div>

      {/* Liste participants + cotisations */}
      {loadingCot ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-sub)" }}>Chargement...</div>
      ) : participants.length === 0 ? (
        <EmptyState icon="👥" title="Aucun participant" subtitle="Ajoutez des participants à cet événement pour commencer à gérer les cotisations." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {participants.map(p => {
            const cotP = cotisations.filter(c => c.participant_name === p);
            const totalP = cotP.reduce((s, c) => s + c.montant, 0);
            const hasCot = cotP.length > 0;
            const allPaid = cotP.every(c => c.statut === "paye");

            return (
              <div key={p} style={{ background: "var(--bg-secondary)", borderRadius: 14, border: `1px solid ${!hasCot ? "#FFE082" : allPaid ? "#C8E6C9" : "var(--border)"}`, overflow: "hidden" }}>
                {/* En-tête participant */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                  <Avatar name={p} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</div>
                    <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 2 }}>
                      {hasCot ? `${cotP.length} cotisation(s) · ${fmt(totalP, sym)}` : "Aucune cotisation"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: !hasCot ? "#FFF8E1" : allPaid ? "#E8F5E9" : "#FFEBEE", color: !hasCot ? "#F57F17" : allPaid ? "#2E7D32" : "#C62828", fontWeight: 700 }}>
                      {!hasCot ? "⏳ En attente" : allPaid ? "✓ Soldé" : "~ Partiel"}
                    </span>
                    <button onClick={() => { setForm({ ...emptyForm, participant_name: p }); setEditingCot(null); setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--hover-bg)", color: "var(--text-muted)", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                      + Cotisation
                    </button>
                  </div>
                </div>

                {/* Détail cotisations */}
                {cotP.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)" }}>
                    {cotP.map((cot, i) => {
                      const fb = formeBadge(cot.forme);
                      const sb = statutBadge(cot.statut);
                      return (
                        <div key={cot.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: i < cotP.length - 1 ? "1px solid var(--border)" : "none", background: "var(--hover-bg)" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 20, background: fb.bg, color: fb.color, fontWeight: 600 }}>{fb.label}</span>
                              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 20, background: sb.bg, color: sb.color, fontWeight: 600 }}>{sb.label}</span>
                            </div>
                            {cot.description && <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {cot.description}</div>}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{fmt(cot.montant, sym)}</div>
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            <button onClick={() => { setEditingCot(cot); setForm({ participant_name: cot.participant_name, montant: cot.montant, forme: cot.forme, description: cot.description || "" }); setMontantMode("libre"); setShowForm(true); setShowGroupForm(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                              style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #FFE082", background: "#FFF8E1", color: "#F57F17", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>✏️</button>
                            <button onClick={() => handleDelete(cot)}
                              style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #FFCDD2", background: "#FFEBEE", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>🗑</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

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
    contributions: "Contributions",
    analytics: t("nav_analytics"), history: t("nav_history"),
    invite: t("nav_invite"), notifications: t("nav_notifications"),
    settings: t("nav_settings") || "Paramètres",
    cotisations: "Cotisations",
    superadmin: "Super Admin",
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
        // Charger le profil pour détecter le rôle admin
        try {
          const { data: prof } = await fetchProfile(u.id);
          setProfile(prof || null);
          // Rediriger automatiquement le super admin vers sa page dédiée
          if (prof?.user_role === "admin") setActive("superadmin");
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
  const hasBudgetEvents = events.some(e => e.event_type === "budget");

  const pages = isAdmin ? {
    superadmin: <SuperAdminPage user={user} isMobile={isMobile} addToast={addToast} />,
  } : {
    dashboard:     <Dashboard {...sharedProps} navigateTo={setActive} lang={lang} />,
    events:        <Events {...sharedProps} />,
    expenses:      <Expenses {...sharedProps} />,
    balance:       <Balance {...sharedProps} />,
    contributions: <ContributionsPage {...sharedProps} />,
    cotisations:   <CotisationsPage events={events} expenses={expenses} user={user} reload={loadAll} isMobile={isMobile} addToast={addToast} t={t} />,
    analytics:     <Analytics {...sharedProps} />,
    history:       <History events={events} history={history} user={user} reload={loadAll} isMobile={isMobile} addToast={addToast} t={t} />,
    invite:        <Invite events={events} user={user} isMobile={isMobile} addToast={addToast} t={t} />,
    notifications: <NotificationsPage notifications={notifications} events={events} expenses={expenses}
                     pendingActions={pendingActions} user={user} reload={loadAll} isMobile={isMobile} addToast={addToast} t={t}
                     onMarkAll={async () => { await markAllNotificationsRead(user.id); await loadAll(); addToast(t("notif_mark_all"), "info"); }}
                     onDismiss={async (id) => { await deleteNotification(id); await loadAll(); }} />,
    settings:      <SettingsPage user={user} onSignOut={handleSignOut} isMobile={isMobile} addToast={addToast} t={t} events={events} />,
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
      {!isOnline && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, background: "#F57F17", color: "#fff", textAlign: "center", padding: "8px 16px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          ⚠️ Connexion perdue — vos modifications ne seront pas enregistrées
        </div>
      )}
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      <Sidebar active={active} setActive={setActive} unreadCount={unreadCount} pendingCount={pendingCount}
        user={user} onSignOut={handleSignOut} isMobile={isMobile} menuOpen={menuOpen} setMenuOpen={setMenuOpen}
        t={t} lang={lang} setLang={setLang} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        isAdmin={isAdmin} hasBudgetEvents={hasBudgetEvents} />

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
