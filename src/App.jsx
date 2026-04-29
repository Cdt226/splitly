import { useState, useEffect, useCallback } from "react";
import {
  supabase, signUp, signIn, signOut, getSession,
  fetchEvents, createEvent, updateEventStatus, deleteEvent,
  fetchExpenses, createExpense, updateExpense, deleteExpense,
  fetchContributions, upsertContribution,
  fetchHistory, invalidateHistory,
  fetchNotifications, markAllNotificationsRead, deleteNotification,
  fetchInvitations, sendInvitation,
  subscribeToNotifications, unsubscribe,
} from "./supabase.js";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const CATEGORIES = {
  Nourriture:  { icon: "🍽️", color: "#E8F5E9", accent: "#2E7D32", subs: ["Entrée", "Plat", "Dessert"] },
  Boisson:     { icon: "🥤", color: "#E3F2FD", accent: "#1565C0", subs: ["Alcool", "Jus", "Eau", "Autre"] },
  Transport:   { icon: "🚖", color: "#FFF8E1", accent: "#F57F17", subs: ["Taxi", "Tram", "Bus", "Autre"] },
  Accessoires: { icon: "🎉", color: "#F3E5F5", accent: "#6A1B9A", subs: ["Décoration", "Matériel", "Autre"] },
};
const CURRENCIES = ["EUR €", "USD $", "GBP £", "XOF FCFA", "MAD DH", "CAD $"];

// ─── RESPONSIVE HOOK ──────────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// ─── LOGIQUE MÉTIER ───────────────────────────────────────────────────────────
const currencySymbol = (c) => c?.split(" ")[1] || "€";

function computeOwed(expenses, person) {
  return expenses.reduce((sum, ex) => {
    const included = ex.included || [];
    if (!included.includes(person)) return sum;
    return sum + (ex.qty * (ex.unit_price ?? 0)) / included.length;
  }, 0);
}

function computeNetBalance(expenses, contributions, person) {
  return (contributions[person] || 0) - computeOwed(expenses, person);
}

const isSettled = (net) => Math.abs(net) <= 1;

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

// ─── COMPOSANTS UI ────────────────────────────────────────────────────────────
function Avatar({ name = "?", size = 32 }) {
  const colors = ["#2E7D32", "#1565C0", "#F57F17", "#6A1B9A", "#C62828", "#00695C", "#AD1457"];
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: colors[name.charCodeAt(0) % colors.length], color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, flexShrink: 0, fontFamily: "sans-serif" }}>
      {name[0].toUpperCase()}
    </div>
  );
}

function Badge({ label, color, accent }) {
  return <span style={{ background: color, color: accent, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, border: `1px solid ${accent}22`, whiteSpace: "nowrap" }}>{label}</span>;
}

function AvatarStack({ names = [], size = 24 }) {
  const show = names.slice(0, 5);
  const rest = names.length - 5;
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {show.map((n, i) => (
        <div key={n} style={{ marginLeft: i > 0 ? -8 : 0, border: "2px solid #fff", borderRadius: "50%" }} title={n}>
          <Avatar name={n} size={size} />
        </div>
      ))}
      {rest > 0 && <span style={{ marginLeft: 4, fontSize: 11, color: "#aaa", fontFamily: "sans-serif" }}>+{rest}</span>}
    </div>
  );
}

// ★ Saisie libre des participants
function ParticipantInput({ participants, onChange }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    const name = input.trim();
    if (!name) return;
    if (participants.map(p => p.toLowerCase()).includes(name.toLowerCase())) {
      setError("Ce nom est déjà dans la liste."); return;
    }
    onChange([...participants, name]);
    setInput(""); setError("");
  };

  const remove = (name) => onChange(participants.filter(p => p !== name));

  return (
    <div>
      <label style={S.label}>Participants (min. 2)</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          style={{ ...S.input, flex: 1 }}
          placeholder="Entrez un prénom et appuyez sur +"
          value={input}
          onChange={e => { setInput(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && add()}
        />
        <button onClick={add} style={{ ...S.btnDark, padding: "9px 16px", borderRadius: 8, flexShrink: 0 }}>+</button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#C62828", marginBottom: 6, fontFamily: "sans-serif" }}>{error}</div>}
      {participants.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {participants.map(p => (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: 6, background: "#0F0F0F", color: "#fff", borderRadius: 20, padding: "4px 12px", fontSize: 13, fontFamily: "sans-serif" }}>
              <Avatar name={p} size={18} />
              {p}
              <button onClick={() => remove(p)} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}
      {participants.length > 0 && participants.length < 2 && (
        <div style={{ fontSize: 12, color: "#F57F17", marginTop: 6, fontFamily: "sans-serif" }}>⚠️ Ajoutez au moins 2 participants</div>
      )}
    </div>
  );
}

function ParticipantToggle({ people, selected, onChange, label }) {
  return (
    <div>
      <label style={S.label}>{label}</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {people.map(p => {
          const sel = selected.includes(p);
          return (
            <button key={p} onClick={() => onChange(sel ? selected.filter(x => x !== p) : [...selected, p])}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${sel ? "#0F0F0F" : "#ddd"}`, background: sel ? "#0F0F0F" : "#fff", color: sel ? "#fff" : "#555", cursor: "pointer", fontSize: 12.5, fontFamily: "sans-serif", fontWeight: 500 }}>
              <Avatar name={p} size={18} />{p}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 500, maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "sans-serif" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#aaa" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({ message, warnings = [], onConfirm, onCancel }) {
  return (
    <Modal title="Confirmer" onClose={onCancel}>
      <p style={{ fontSize: 14, fontFamily: "sans-serif", marginBottom: 12 }}>{message}</p>
      {warnings.map((w, i) => (
        <div key={i} style={{ background: "#FFF8E1", border: "1px solid #F57F17", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#F57F17", marginBottom: 8 }}>⚠️ {w}</div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={onConfirm} style={S.btnDark}>Confirmer</button>
        <button onClick={onCancel} style={S.btnGhost}>Annuler</button>
      </div>
    </Modal>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f4f4f4" }}>
      <div style={{ width: 36, height: 36, border: "3px solid #eee", borderTop: "3px solid #0F0F0F", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handle = async () => {
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

  if (mode === "confirm") return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f4f4f4", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: "100%", maxWidth: 380, textAlign: "center", boxShadow: "0 4px 30px rgba(0,0,0,0.08)" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>📧</div>
        <div style={{ fontFamily: "sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Vérifiez votre email</div>
        <p style={{ color: "#888", fontSize: 14, fontFamily: "sans-serif" }}>Un lien a été envoyé à <strong>{form.email}</strong>. Cliquez dessus puis connectez-vous.</p>
        <button onClick={() => setMode("login")} style={{ ...S.btnDark, marginTop: 20, width: "100%" }}>Se connecter</button>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f4f4f4", padding: 16 }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: "100%", maxWidth: 380, boxShadow: "0 4px 30px rgba(0,0,0,0.08)" }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 700, marginBottom: 4 }}>SplitLy</div>
        <div style={{ color: "#888", fontSize: 13, marginBottom: 24, fontFamily: "sans-serif" }}>
          {mode === "login" ? "Connectez-vous à votre compte" : "Créez votre compte"}
        </div>
        {mode === "register" && (
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Nom complet</label>
            <input style={S.input} placeholder="Alice Martin" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <label style={S.label}>Email</label>
          <input style={S.input} type="email" placeholder="alice@mail.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Mot de passe</label>
          <input style={S.input} type="password" placeholder="••••••••" value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            onKeyDown={e => e.key === "Enter" && handle()} />
        </div>
        {error && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#C62828", marginBottom: 14 }}>{error}</div>}
        <button onClick={handle} disabled={loading} style={{ ...S.btnDark, width: "100%", justifyContent: "center", display: "flex", opacity: loading ? 0.7 : 1 }}>
          {loading ? "Chargement..." : mode === "login" ? "Se connecter" : "Créer le compte"}
        </button>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, fontFamily: "sans-serif", color: "#888" }}>
          {mode === "login" ? "Pas encore de compte ? " : "Déjà un compte ? "}
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
            style={{ background: "none", border: "none", color: "#0F0F0F", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
            {mode === "login" ? "S'inscrire" : "Se connecter"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SIDEBAR DESKTOP + NAV MOBILE ─────────────────────────────────────────────
function Sidebar({ active, setActive, unreadCount, user, onSignOut, isMobile, menuOpen, setMenuOpen }) {
  const nav = [
    { key: "dashboard",     icon: "◈", label: "Tableau de bord" },
    { key: "events",        icon: "◉", label: "Événements" },
    { key: "expenses",      icon: "◫", label: "Charges" },
    { key: "balance",       icon: "⊜", label: "Répartition" },
    { key: "analytics",     icon: "◐", label: "Analyses" },
    { key: "history",       icon: "◷", label: "Historique" },
    { key: "invite",        icon: "◎", label: "Inviter" },
    { key: "notifications", icon: "◬", label: "Notifications", badge: unreadCount },
  ];

  if (isMobile) {
    return (
      <>
        {/* Top bar mobile */}
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 56, background: "#0F0F0F", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", zIndex: 200 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: "#fff" }}>SplitLy</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {unreadCount > 0 && <span style={{ background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "2px 7px" }}>{unreadCount}</span>}
            <button onClick={() => setMenuOpen(!menuOpen)} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer" }}>☰</button>
          </div>
        </div>
        {/* Drawer mobile */}
        {menuOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 300 }}>
            <div onClick={() => setMenuOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 260, background: "#0F0F0F", display: "flex", flexDirection: "column", padding: "24px 0" }}>
              <div style={{ padding: "0 20px 20px", borderBottom: "1px solid #1e1e1e" }}>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: "#fff" }}>SplitLy</div>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "12px 8px" }}>
                {nav.map(n => (
                  <button key={n.key} onClick={() => { setActive(n.key); setMenuOpen(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: active === n.key ? "#1a1a1a" : "transparent", color: active === n.key ? "#fff" : "#666", fontFamily: "sans-serif", fontSize: 14, fontWeight: active === n.key ? 600 : 400, textAlign: "left", width: "100%" }}>
                    <span style={{ fontSize: 16 }}>{n.icon}</span>
                    <span style={{ flex: 1 }}>{n.label}</span>
                    {n.badge > 0 && <span style={{ background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>{n.badge}</span>}
                  </button>
                ))}
              </div>
              <div style={{ padding: "16px", borderTop: "1px solid #1e1e1e" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <Avatar name={user?.user_metadata?.full_name?.[0] || user?.email?.[0] || "U"} size={28} />
                  <div style={{ color: "#fff", fontSize: 12, fontFamily: "sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.user_metadata?.full_name || user?.email}</div>
                </div>
                <button onClick={onSignOut} style={{ width: "100%", padding: "7px", borderRadius: 8, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontSize: 12, cursor: "pointer" }}>Déconnexion</button>
              </div>
            </div>
          </div>
        )}
        {/* Bottom nav mobile */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 60, background: "#0F0F0F", display: "flex", alignItems: "center", justifyContent: "space-around", zIndex: 200, borderTop: "1px solid #1e1e1e" }}>
          {nav.slice(0, 5).map(n => (
            <button key={n.key} onClick={() => setActive(n.key)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "none", border: "none", cursor: "pointer", color: active === n.key ? "#fff" : "#555", padding: "6px 8px", position: "relative" }}>
              <span style={{ fontSize: 18 }}>{n.icon}</span>
              <span style={{ fontSize: 9, fontFamily: "sans-serif" }}>{n.label.split(" ")[0]}</span>
              {n.badge > 0 && <span style={{ position: "absolute", top: 2, right: 2, background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 9, fontWeight: 700, padding: "0 4px" }}>{n.badge}</span>}
            </button>
          ))}
        </div>
      </>
    );
  }

  // Desktop sidebar
  return (
    <aside style={{ width: 220, background: "#0F0F0F", display: "flex", flexDirection: "column", padding: "28px 0", flexShrink: 0 }}>
      <div style={{ padding: "0 22px 24px", borderBottom: "1px solid #1e1e1e" }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: "#fff" }}>SplitLy</div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 3, fontFamily: "sans-serif" }}>Gestion de dépenses</div>
      </div>
      <div style={{ padding: "16px 10px 0", flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {nav.map(n => (
          <button key={n.key} onClick={() => setActive(n.key)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: active === n.key ? "#1a1a1a" : "transparent", color: active === n.key ? "#fff" : "#666", fontFamily: "sans-serif", fontSize: 13, fontWeight: active === n.key ? 600 : 400, textAlign: "left" }}>
            <span style={{ fontSize: 14, opacity: active === n.key ? 1 : 0.5 }}>{n.icon}</span>
            <span style={{ flex: 1 }}>{n.label}</span>
            {n.badge > 0 && <span style={{ background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>{n.badge}</span>}
          </button>
        ))}
      </div>
      <div style={{ padding: "14px", borderTop: "1px solid #1e1e1e" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Avatar name={user?.user_metadata?.full_name?.[0] || user?.email?.[0] || "U"} size={28} />
          <div style={{ overflow: "hidden" }}>
            <div style={{ color: "#fff", fontSize: 11, fontWeight: 600, fontFamily: "sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.user_metadata?.full_name || user?.email}</div>
            <div style={{ color: "#F57F17", fontSize: 10, fontFamily: "sans-serif" }}>Admin</div>
          </div>
        </div>
        <button onClick={onSignOut} style={{ width: "100%", padding: "6px", borderRadius: 8, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontSize: 11, cursor: "pointer", fontFamily: "sans-serif" }}>Déconnexion</button>
      </div>
    </aside>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ events, expenses, user, isMobile }) {
  const name = user?.user_metadata?.full_name?.split(" ")[0] || "vous";
  const totalSpent = expenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const byCategory = Object.keys(CATEGORIES).map(cat => ({
    cat, total: expenses.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0),
  })).filter(c => c.total > 0);

  return (
    <div>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 6 }}>Bonjour, {name} 👋</h2>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 20, fontFamily: "sans-serif" }}>Résumé de vos dépenses partagées.</p>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total dépensé", value: `${totalSpent.toFixed(2)} €`, sub: `${expenses.length} charges` },
          { label: "Événements", value: events.length, sub: `${events.filter(e => e.status === "open").length} ouvert(s)` },
          { label: "Participants", value: [...new Set(events.flatMap(e => (e.event_participants || []).map(p => p.name)))].length, sub: "tous événements" },
        ].map((c, idx) => (
          <div key={c.label} style={{ background: "#f8f8f8", borderRadius: 12, padding: "16px", border: "1px solid #eee", gridColumn: isMobile && idx === 2 ? "1 / -1" : "auto" }}>
            <div style={{ fontSize: 10, color: "#888", fontFamily: "sans-serif", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{c.label}</div>
            <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{c.value}</div>
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 2, fontFamily: "sans-serif" }}>{c.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
        <div style={{ background: "#f8f8f8", borderRadius: 14, padding: 16, border: "1px solid #eee" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, fontFamily: "sans-serif" }}>Par catégorie</div>
          {byCategory.length === 0 && <div style={{ color: "#ccc", fontSize: 13, fontFamily: "sans-serif" }}>Aucune charge</div>}
          {byCategory.map(c => (
            <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 16 }}>{CATEGORIES[c.cat].icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12, fontFamily: "sans-serif" }}>{c.cat}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "sans-serif" }}>{c.total.toFixed(2)} €</span>
                </div>
                <div style={{ background: "#e5e5e5", borderRadius: 4, height: 5 }}>
                  <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 4, height: 5, width: `${totalSpent > 0 ? (c.total / totalSpent) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: "#f8f8f8", borderRadius: 14, padding: 16, border: "1px solid #eee" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, fontFamily: "sans-serif" }}>Événements récents</div>
          {events.length === 0 && <div style={{ color: "#ccc", fontSize: 13, fontFamily: "sans-serif" }}>Aucun événement créé</div>}
          {events.slice(0, 5).map(ev => {
            const evTotal = expenses.filter(e => e.event_id === ev.id).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
            const participants = (ev.event_participants || []).map(p => p.name);
            return (
              <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: "#fff", border: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{ev.status === "closed" ? "🔒" : "🎊"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</div>
                  <div style={{ fontSize: 11, color: "#aaa", fontFamily: "sans-serif" }}>{ev.date} · {participants.length} p.</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", flexShrink: 0 }}>{evTotal.toFixed(2)} {currencySymbol(ev.currency)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── ÉVÉNEMENTS ───────────────────────────────────────────────────────────────
function Events({ events, expenses, contributions, user, reload, isMobile }) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", date: "", currency: "EUR €", participants: [] });
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const handleCreate = async () => {
    if (!form.name || !form.date || form.participants.length < 2) return;
    setLoading(true);
    const { error } = await createEvent(form, form.participants, user.id);
    if (!error) { await reload(); setForm({ name: "", date: "", currency: "EUR €", participants: [] }); setShowNew(false); }
    else alert("Erreur : " + error.message);
    setLoading(false);
  };

  const handleDelete = (ev) => {
    setConfirm({
      message: `Supprimer "${ev.name}" et toutes ses charges ?`,
      onConfirm: async () => { await deleteEvent(ev.id); await reload(); setConfirm(null); },
      onCancel: () => setConfirm(null),
    });
  };

  const handleClose = async (ev) => {
    const evExp = expenses.filter(e => e.event_id === ev.id);
    const participants = (ev.event_participants || []).map(p => p.name);
    const evContribMap = {};
    (contributions[ev.id] || []).forEach(c => { evContribMap[c.participant] = c.amount; });
    const allSettled = participants.every(p => isSettled(computeNetBalance(evExp, evContribMap, p)));
    if (!allSettled) { alert("Tous les participants doivent solder avant de boucler."); return; }
    setConfirm({
      message: `Boucler "${ev.name}" ? L'historique sera effacé. Irréversible.`,
      onConfirm: async () => { await updateEventStatus(ev.id, "closed"); await reload(); setConfirm(null); },
      onCancel: () => setConfirm(null),
    });
  };

  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 2 }}>Événements</h2>
          <p style={{ color: "#888", fontSize: 12, fontFamily: "sans-serif" }}>{events.length} événement(s)</p>
        </div>
        <button onClick={() => setShowNew(!showNew)} style={S.btnDark}>+ Nouveau</button>
      </div>

      {showNew && (
        <div style={S.card}>
          <div style={S.sectionTitle}>Créer un événement</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div><label style={S.label}>Nom de l'événement</label><input style={S.input} placeholder="Soirée chez Marc" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={S.label}>Date</label><input type="date" style={S.input} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
              <label style={S.label}>Monnaie</label>
              <select style={{ ...S.input, maxWidth: isMobile ? "100%" : 200 }} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {/* ★ Saisie libre des participants */}
          <div style={{ marginBottom: 16 }}>
            <ParticipantInput participants={form.participants} onChange={p => setForm({ ...form, participants: p })} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={handleCreate} disabled={loading || form.participants.length < 2} style={{ ...S.btnDark, opacity: form.participants.length < 2 ? 0.5 : 1 }}>{loading ? "..." : "Créer"}</button>
            <button onClick={() => setShowNew(false)} style={S.btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {events.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#bbb", fontSize: 14, fontFamily: "sans-serif" }}>Aucun événement. Créez-en un !</div>}
        {events.map(ev => {
          const participants = (ev.event_participants || []).map(p => p.name);
          const evTotal = expenses.filter(e => e.event_id === ev.id).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
          const evContribMap = {};
          (contributions[ev.id] || []).forEach(c => { evContribMap[c.participant] = c.amount; });
          const evExp = expenses.filter(e => e.event_id === ev.id);
          const allSettled = participants.length > 0 && participants.every(p => isSettled(computeNetBalance(evExp, evContribMap, p)));
          return (
            <div key={ev.id} style={{ background: "#fff", borderRadius: 14, padding: isMobile ? "14px 16px" : "16px 20px", border: "1px solid #eee" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: ev.status === "closed" ? "#f5f5f5" : "#f0faf4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{ev.status === "closed" ? "🔒" : "🎊"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "sans-serif" }}>{ev.name}</span>
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: ev.status === "closed" ? "#f0f0f0" : "#E8F5E9", color: ev.status === "closed" ? "#999" : "#2E7D32", fontFamily: "sans-serif", fontWeight: 600 }}>
                      {ev.status === "closed" ? "Bouclé" : "Ouvert"}
                    </span>
                    {allSettled && ev.status === "open" && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#E3F2FD", color: "#1565C0", fontFamily: "sans-serif", fontWeight: 600 }}>✓ Prêt</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 8, fontFamily: "sans-serif" }}>📅 {ev.date} · {currencySymbol(ev.currency)} · {participants.length} participants</div>
                  <AvatarStack names={participants} size={22} />
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{evTotal.toFixed(2)} {currencySymbol(ev.currency)}</div>
                  {ev.status === "open" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {allSettled && <button onClick={() => handleClose(ev)} style={{ ...S.btnDark, padding: "4px 10px", fontSize: 11 }}>🔒 Boucler</button>}
                      <button onClick={() => handleDelete(ev)} style={{ padding: "4px 10px", borderRadius: 7, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontFamily: "sans-serif", fontWeight: 600 }}>Supprimer</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CHARGES ──────────────────────────────────────────────────────────────────
function Expenses({ events, expenses, user, reload, isMobile }) {
  const [showForm, setShowForm] = useState(false);
  const [filterEvent, setFilterEvent] = useState("all");
  const [editingEx, setEditingEx] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
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
  const sharePerPerson = form.included.length > 0 ? total / form.included.length : 0;

  const handleSave = async () => {
    if (!form.eventId || !form.category || !form.sub || !form.detail || !form.paidBy || form.included.length === 0 || total === 0) return;
    setSaving(true);
    if (editingEx) await updateExpense(editingEx.id, { ...form, qty: Number(form.qty), unit: Number(form.unit) }, user.id, editingEx);
    else await createExpense({ ...form, qty: Number(form.qty), unit: Number(form.unit) }, user.id);
    await reload();
    setForm(empty); setEditingEx(null); setShowForm(false); setSaving(false);
  };

  const startEdit = (ex) => {
    setForm({ eventId: ex.event_id, category: ex.category, sub: ex.sub_category || "", detail: ex.detail, qty: ex.qty, unit: ex.unit_price ?? 0, paidBy: ex.paid_by || "", included: [...(ex.included || [])] });
    setEditingEx(ex); setShowForm(true);
  };

  const handleDelete = (ex) => {
    setConfirm({
      message: `Supprimer la charge "${ex.detail}" ?`,
      onConfirm: async () => { await deleteExpense(ex, user.id); await reload(); setConfirm(null); },
      onCancel: () => setConfirm(null),
    });
  };

  const filtered = filterEvent === "all" ? expenses : expenses.filter(e => e.event_id === filterEvent);

  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 2 }}>Charges</h2>
          <p style={{ color: "#888", fontSize: 12, fontFamily: "sans-serif" }}>{expenses.length} dépense(s)</p>
        </div>
        <button onClick={() => { setForm(empty); setEditingEx(null); setShowForm(!showForm); }} style={S.btnDark}>+ Ajouter</button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <select style={{ ...S.input, width: "auto", maxWidth: "100%" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          <option value="all">Tous les événements</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
      </div>

      {showForm && (
        <div style={S.card}>
          <div style={S.sectionTitle}>{editingEx ? "Modifier la charge" : "Nouvelle charge"}</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={S.label}>Événement</label>
              <select style={S.input} value={form.eventId} onChange={e => handleEventChange(e.target.value)} disabled={!!editingEx}>
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
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Détail / Nature</label>
            <input style={S.input} placeholder="Ex: Vin rouge, Salade César..." value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div><label style={S.label}>Quantité</label><input type="number" min="1" style={S.input} value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
            <div><label style={S.label}>Prix unitaire</label><input type="number" min="0" step="0.01" style={S.input} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
            <div><label style={S.label}>Total</label><div style={{ ...S.input, background: "#f0faf4", color: "#2E7D32", fontWeight: 700, display: "flex", alignItems: "center" }}>{total.toFixed(2)}</div></div>
          </div>
          {currentEvent && (
            <div style={{ marginBottom: 14, padding: 14, background: "#fafafa", borderRadius: 10, border: "1px solid #eee" }}>
              <ParticipantToggle people={participants} selected={form.included} onChange={p => setForm({ ...form, included: p })} label="Qui partage cette charge ?" />
              {form.included.length > 0 && total > 0 && (
                <div style={{ marginTop: 10, padding: "7px 12px", background: "#E8F5E9", borderRadius: 8, fontSize: 12, color: "#2E7D32", fontFamily: "sans-serif", fontWeight: 600 }}>
                  ➗ {sharePerPerson.toFixed(2)} / personne · {form.included.length} inclus
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={handleSave} disabled={saving} style={S.btnDark}>{saving ? "..." : editingEx ? "Enregistrer" : "Ajouter"}</button>
            <button onClick={() => { setShowForm(false); setEditingEx(null); }} style={S.btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Vue mobile : cartes */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "#bbb", fontSize: 13, fontFamily: "sans-serif" }}>Aucune charge</div>}
          {filtered.map(ex => {
            const cat = CATEGORIES[ex.category];
            const ev = events.find(e => e.id === ex.event_id);
            const t = ex.qty * (ex.unit_price ?? 0);
            const included = ex.included || [];
            const share = included.length > 0 ? t / included.length : 0;
            return (
              <div key={ex.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #eee" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{cat?.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "sans-serif" }}>{ex.detail}</div>
                      <div style={{ fontSize: 11, color: "#aaa", fontFamily: "sans-serif" }}>{ev?.name}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{t.toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: "#2E7D32", fontFamily: "sans-serif" }}>{share.toFixed(2)}/p.</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {cat && <Badge label={ex.sub_category} color={cat.color} accent={cat.accent} />}
                    <span style={{ fontSize: 11, color: "#888", fontFamily: "sans-serif" }}>par {ex.paid_by}</span>
                  </div>
                  {ev?.status === "open" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => startEdit(ex)} style={{ padding: "3px 8px", borderRadius: 6, border: "1.5px solid #ddd", background: "#fff", fontSize: 11, cursor: "pointer" }}>✏️</button>
                      <button onClick={() => handleDelete(ex)} style={{ padding: "3px 8px", borderRadius: 6, border: "1.5px solid #ffcdd2", background: "#fff5f5", fontSize: 11, cursor: "pointer" }}>🗑️</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // Vue desktop : tableau
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "sans-serif", minWidth: 700 }}>
            <thead>
              <tr style={{ background: "#f8f8f8", borderBottom: "1px solid #eee" }}>
                {["Catégorie", "Détail", "Événement", "Qté", "Unit.", "Total", "Part/p.", "Payé par", "Inclus", ""].map(h => (
                  <th key={h} style={{ padding: "10px 10px", fontSize: 10, fontWeight: 700, color: "#888", textAlign: "left", textTransform: "uppercase", letterSpacing: 0.6 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: "#bbb", fontSize: 13 }}>Aucune charge</td></tr>}
              {filtered.map((ex, i) => {
                const cat = CATEGORIES[ex.category];
                const ev = events.find(e => e.id === ex.event_id);
                const t = ex.qty * (ex.unit_price ?? 0);
                const included = ex.included || [];
                const share = included.length > 0 ? t / included.length : 0;
                return (
                  <tr key={ex.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f5f5f5" : "none" }}>
                    <td style={{ padding: "9px 10px" }}><div style={{ display: "flex", alignItems: "center", gap: 5 }}><span>{cat?.icon}</span>{cat && <Badge label={ex.sub_category} color={cat.color} accent={cat.accent} />}</div></td>
                    <td style={{ padding: "9px 10px", fontSize: 12 }}>{ex.detail}</td>
                    <td style={{ padding: "9px 10px", fontSize: 11, color: "#666" }}>{ev?.name}</td>
                    <td style={{ padding: "9px 10px", fontSize: 12, textAlign: "center" }}>{ex.qty}</td>
                    <td style={{ padding: "9px 10px", fontSize: 12 }}>{(ex.unit_price ?? 0).toFixed(2)}</td>
                    <td style={{ padding: "9px 10px", fontSize: 12, fontWeight: 700 }}>{t.toFixed(2)}</td>
                    <td style={{ padding: "9px 10px", fontSize: 11, color: "#2E7D32", fontWeight: 600 }}>{share.toFixed(2)}</td>
                    <td style={{ padding: "9px 10px" }}><div style={{ display: "flex", alignItems: "center", gap: 4 }}><Avatar name={ex.paid_by || "?"} size={18} /><span style={{ fontSize: 11 }}>{ex.paid_by}</span></div></td>
                    <td style={{ padding: "9px 10px" }}><AvatarStack names={included} size={18} /></td>
                    <td style={{ padding: "9px 10px" }}>
                      {ev?.status === "open" && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => startEdit(ex)} style={{ padding: "3px 7px", borderRadius: 6, border: "1.5px solid #ddd", background: "#fff", fontSize: 11, cursor: "pointer" }}>✏️</button>
                          <button onClick={() => handleDelete(ex)} style={{ padding: "3px 7px", borderRadius: 6, border: "1.5px solid #ffcdd2", background: "#fff5f5", fontSize: 11, cursor: "pointer" }}>🗑️</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── RÉPARTITION ─────────────────────────────────────────────────────────────
function Balance({ events, expenses, contributions, user, reload, isMobile }) {
  const [filterEvent, setFilterEvent] = useState(events[0]?.id || "");
  const [settleModal, setSettleModal] = useState(null);
  const [versement, setVersement] = useState({});
  const [saving, setSaving] = useState(false);

  const ev = events.find(e => e.id === filterEvent);
  const evExp = expenses.filter(e => e.event_id === filterEvent);
  const sym = currencySymbol(ev?.currency);
  const participants = (ev?.event_participants || []).map(p => p.name);
  const evContribMap = {};
  (contributions[filterEvent] || []).forEach(c => { evContribMap[c.participant] = c.amount; });

  const handleSettle = (person) => {
    const net = computeNetBalance(evExp, evContribMap, person);
    const owed = computeOwed(evExp, person);
    const current = evContribMap[person] || 0;
    let newAmount, message;
    if (net < -1) { newAmount = current + Math.abs(net); message = `Versement de ${Math.abs(net).toFixed(2)} ${sym} enregistré pour ${person}.`; }
    else if (net > 1) { newAmount = owed; message = `Contribution de ${person} ajustée à ${owed.toFixed(2)} ${sym}.`; }
    else return;
    setSettleModal({ person, newAmount, message });
  };

  const confirmSettle = async () => {
    if (!settleModal) return;
    setSaving(true);
    await upsertContribution(filterEvent, settleModal.person, settleModal.newAmount, user.id);
    await reload();
    setSaving(false); setSettleModal(null);
  };

  const handleVersement = async (person) => {
    const amount = parseFloat(versement[person] || 0);
    if (!amount || amount <= 0) return;
    const current = evContribMap[person] || 0;
    setSaving(true);
    await upsertContribution(filterEvent, person, current + amount, user.id);
    await reload();
    setVersement(v => ({ ...v, [person]: "" }));
    setSaving(false);
  };

  const transactions = participants.length > 0 ? computeTransactions(evExp, evContribMap, participants) : [];

  return (
    <div>
      {settleModal && (
        <Modal title={`Solder ${settleModal.person}`} onClose={() => setSettleModal(null)}>
          <p style={{ fontSize: 14, fontFamily: "sans-serif", marginBottom: 16 }}>{settleModal.message}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={confirmSettle} disabled={saving} style={S.btnDark}>{saving ? "..." : "Confirmer"}</button>
            <button onClick={() => setSettleModal(null)} style={S.btnGhost}>Annuler</button>
          </div>
        </Modal>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 2 }}>Répartition</h2>
          <p style={{ color: "#888", fontSize: 12, fontFamily: "sans-serif" }}>Soldes en temps réel</p>
        </div>
        <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : `repeat(${Math.min(Math.max(participants.length, 1), 4)}, 1fr)`, gap: 10, marginBottom: 16 }}>
        {participants.map(p => {
          const owed = computeOwed(evExp, p);
          const contrib = evContribMap[p] || 0;
          const net = contrib - owed;
          const settled = isSettled(net);
          return (
            <div key={p} style={{ background: "#fff", borderRadius: 12, padding: "14px 12px", border: `1.5px solid ${settled ? "#c8e6c9" : "#eee"}`, textAlign: "center" }}>
              <Avatar name={p} size={32} />
              <div style={{ marginTop: 7, fontSize: 13, fontWeight: 700, fontFamily: "sans-serif" }}>{p}</div>
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 3, fontFamily: "sans-serif" }}>Doit: {owed.toFixed(2)}</div>
              <div style={{ fontSize: 10, color: "#aaa", fontFamily: "sans-serif" }}>Versé: {contrib.toFixed(2)}</div>
              <div style={{ marginTop: 5, fontSize: 13, fontWeight: 700, color: settled ? "#2E7D32" : net > 0 ? "#1565C0" : "#C62828", fontFamily: "'Playfair Display', serif" }}>
                {settled ? "✓ Soldé" : net > 0 ? `+${net.toFixed(2)}` : `${net.toFixed(2)} ${sym}`}
              </div>
              {!settled && ev?.status === "open" && (
                <div style={{ marginTop: 8, display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                  <input type="number" placeholder="Montant" style={{ ...S.input, width: 65, padding: "4px 6px", fontSize: 11 }} value={versement[p] || ""} onChange={e => setVersement(v => ({ ...v, [p]: e.target.value }))} />
                  <button onClick={() => handleVersement(p)} disabled={saving} style={{ ...S.btnDark, padding: "4px 8px", fontSize: 11 }}>+</button>
                  <button onClick={() => handleSettle(p)} style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid #2E7D32", background: "#E8F5E9", color: "#2E7D32", fontSize: 11, cursor: "pointer", fontFamily: "sans-serif", fontWeight: 600 }}>Solder</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif" }}>Remboursements ({transactions.length})</div>
        {transactions.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#bbb", fontSize: 13, fontFamily: "sans-serif" }}>✓ Tout est soldé !</div>}
        {transactions.map((t, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: i < transactions.length - 1 ? "1px solid #f5f5f5" : "none" }}>
            <Avatar name={t.from} size={26} />
            <div style={{ flex: 1, fontSize: 13, fontFamily: "sans-serif" }}>
              <span style={{ fontWeight: 600 }}>{t.from}</span> → <span style={{ fontWeight: 600 }}>{t.to}</span>
            </div>
            <Avatar name={t.to} size={26} />
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{t.amount.toFixed(2)} {sym}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ANALYSES ─────────────────────────────────────────────────────────────────
function Analytics({ events, expenses, contributions, isMobile }) {
  const [sel, setSel] = useState(events[0]?.id || "");
  const ev = events.find(e => e.id === sel);
  const evExp = expenses.filter(e => e.event_id === sel);
  const sym = currencySymbol(ev?.currency);
  const budget = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const participants = (ev?.event_participants || []).map(p => p.name);
  const evContribMap = {};
  (contributions[sel] || []).forEach(c => { evContribMap[c.participant] = c.amount; });
  const byCategory = Object.keys(CATEGORIES).map(cat => ({ cat, total: evExp.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0) })).filter(c => c.total > 0);

  return (
    <div>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 4 }}>Analyses</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {events.map(ev => (
          <button key={ev.id} onClick={() => setSel(ev.id)} style={{ padding: "6px 12px", borderRadius: 20, border: `1.5px solid ${sel === ev.id ? "#0F0F0F" : "#ddd"}`, background: sel === ev.id ? "#0F0F0F" : "#fff", color: sel === ev.id ? "#fff" : "#555", fontSize: 12, cursor: "pointer", fontFamily: "sans-serif" }}>
            {ev.name}
          </button>
        ))}
      </div>
      {ev && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Budget total", value: `${budget.toFixed(2)} ${sym}`, sub: `${evExp.length} charges` },
              { label: "Participants", value: participants.length, sub: `Moy. ${participants.length > 0 ? (budget / participants.length).toFixed(2) : 0} ${sym}/p.` },
              { label: "Statut", value: ev.status === "closed" ? "Bouclé 🔒" : "Ouvert", sub: ev.date },
            ].map((c, idx) => (
              <div key={c.label} style={{ background: "#f8f8f8", borderRadius: 12, padding: "14px", border: "1px solid #eee", gridColumn: isMobile && idx === 2 ? "1 / -1" : "auto" }}>
                <div style={{ fontSize: 10, color: "#888", fontFamily: "sans-serif", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{c.value}</div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 2, fontFamily: "sans-serif" }}>{c.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, fontFamily: "sans-serif" }}>Par catégorie</div>
              {byCategory.length === 0 && <div style={{ color: "#ccc", fontSize: 13, fontFamily: "sans-serif" }}>Aucune charge</div>}
              {byCategory.map(c => (
                <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>{CATEGORIES[c.cat].icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontFamily: "sans-serif" }}>{c.cat}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "sans-serif" }}>{c.total.toFixed(2)} ({budget > 0 ? ((c.total / budget) * 100).toFixed(0) : 0}%)</span>
                    </div>
                    <div style={{ background: "#eee", borderRadius: 4, height: 5 }}>
                      <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 4, height: 5, width: `${budget > 0 ? (c.total / budget) * 100 : 0}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, fontFamily: "sans-serif" }}>Contributions</div>
              {participants.map(p => {
                const owed = computeOwed(evExp, p);
                const paid = evContribMap[p] || 0;
                return (
                  <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <Avatar name={p} size={26} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "sans-serif", marginBottom: 2 }}>{p}</div>
                      <div style={{ fontSize: 10, color: "#aaa", fontFamily: "sans-serif" }}>Dû: {owed.toFixed(2)} · Versé: {paid.toFixed(2)}</div>
                    </div>
                    <div style={{ width: 60, background: "#eee", borderRadius: 4, height: 5 }}>
                      <div style={{ background: "#2E7D32", borderRadius: 4, height: 5, width: `${owed > 0 ? Math.min((paid / owed) * 100, 100) : 100}%` }} />
                    </div>
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

// ─── HISTORIQUE ───────────────────────────────────────────────────────────────
function History({ events, history, user, reload, isMobile }) {
  const [filterEvent, setFilterEvent] = useState("all");
  const [confirm, setConfirm] = useState(null);
  const filtered = filterEvent === "all" ? history : history.filter(h => h.event_id === filterEvent);

  const handleRollback = (entry) => {
    const later = history.filter(h => h.event_id === entry.event_id && h.created_at >= entry.created_at && !h.invalidated);
    setConfirm({
      message: `Invalider "${entry.action}" ?`,
      warnings: later.length > 1 ? [`${later.length - 1} modification(s) ultérieure(s) également invalidées.`] : [],
      onConfirm: async () => { await invalidateHistory(entry.id, entry.event_id); await reload(); setConfirm(null); },
      onCancel: () => setConfirm(null),
    });
  };

  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 2 }}>Historique</h2>
          <p style={{ color: "#888", fontSize: 12, fontFamily: "sans-serif" }}>Modifications · Rollback disponible</p>
        </div>
        <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          <option value="all">Tous</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" }}>
        {filtered.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#bbb", fontSize: 13, fontFamily: "sans-serif" }}>Aucune modification</div>}
        {[...filtered].reverse().map((h, i) => {
          const ev = events.find(e => e.id === h.event_id);
          const color = h.invalidated ? "#ccc" : h.action.includes("supprim") ? "#C62828" : h.action.includes("ajout") || h.action.includes("créé") ? "#2E7D32" : "#1565C0";
          return (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: i < filtered.length - 1 ? "1px solid #f5f5f5" : "none", opacity: h.invalidated ? 0.4 : 1 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.action} {h.invalidated && <span style={{ fontSize: 10, color: "#aaa", fontWeight: 400 }}>(invalidé)</span>}
                </div>
                <div style={{ fontSize: 11, color: "#aaa", fontFamily: "sans-serif" }}>
                  {ev?.name || "–"} · {new Date(h.created_at).toLocaleString("fr-FR")}
                </div>
              </div>
              {!h.invalidated && ev?.status === "open" && (
                <button onClick={() => handleRollback(h)} style={{ padding: "4px 10px", borderRadius: 6, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontFamily: "sans-serif", fontWeight: 600, flexShrink: 0 }}>
                  ↩ Invalider
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── INVITATIONS ──────────────────────────────────────────────────────────────
function Invite({ events, user, isMobile }) {
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
    if (!email || selectedEvents.length === 0) return;
    setSaving(true);
    for (const evId of selectedEvents) await sendInvitation({ eventId: evId, email, role, invitedBy: user.id });
    setEmail(""); setSelectedEvents([]); setRole("read");
    await loadInvites();
    setSaving(false);
  };

  return (
    <div>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 4 }}>Invitations</h2>
      <p style={{ color: "#888", fontSize: 12, marginBottom: 20, fontFamily: "sans-serif" }}>Gérez l'accès de vos invités</p>
      <div style={S.card}>
        <div style={S.sectionTitle}>Envoyer une invitation</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div><label style={S.label}>Email</label><input style={S.input} type="email" placeholder="ami@example.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div><label style={S.label}>Niveau d'accès</label>
            <select style={S.input} value={role} onChange={e => setRole(e.target.value)}>
              <option value="read">Lecture seule</option>
              <option value="edit">Peut ajouter des charges</option>
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={S.label}>Événements accessibles</label>
          {events.map(ev => (
            <label key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontFamily: "sans-serif", marginTop: 8 }}>
              <input type="checkbox" checked={selectedEvents.includes(ev.id)} onChange={() => setSelectedEvents(s => s.includes(ev.id) ? s.filter(x => x !== ev.id) : [...s, ev.id])} />
              {ev.name} <span style={{ color: "#aaa" }}>({ev.date})</span>
            </label>
          ))}
        </div>
        <button onClick={handleSend} disabled={saving} style={S.btnDark}>{saving ? "..." : "Envoyer ✉️"}</button>
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", fontSize: 13, fontWeight: 700, fontFamily: "sans-serif" }}>Invités ({invitations.length})</div>
        {invitations.length === 0 && <div style={{ padding: 20, color: "#bbb", fontSize: 13, fontFamily: "sans-serif" }}>Aucune invitation</div>}
        {invitations.map((inv, i) => (
          <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: i < invitations.length - 1 ? "1px solid #f5f5f5" : "none", flexWrap: "wrap" }}>
            <Avatar name={inv.email[0]} size={30} />
            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "sans-serif" }}>{inv.email}</div>
              <div style={{ fontSize: 11, color: "#aaa", fontFamily: "sans-serif" }}>{inv.eventName}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 20, background: inv.status === "accepted" ? "#E8F5E9" : "#FFF8E1", color: inv.status === "accepted" ? "#2E7D32" : "#F57F17", fontFamily: "sans-serif" }}>
              {inv.status === "accepted" ? "Accepté" : "En attente"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
function NotificationsPage({ notifications, events, onMarkAll, onDismiss, isMobile }) {
  const typeColor = (t) => ({ success: "#2E7D32", warning: "#F57F17", info: "#1565C0", request: "#6A1B9A" }[t] || "#888");
  const typeBg = (t) => ({ success: "#E8F5E9", warning: "#FFF8E1", info: "#E3F2FD", request: "#F3E5F5" }[t] || "#f8f8f8");
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 2 }}>Notifications</h2>
          <p style={{ color: "#888", fontSize: 12, fontFamily: "sans-serif" }}>{notifications.filter(n => !n.is_read).length} non lue(s)</p>
        </div>
        <button onClick={onMarkAll} style={S.btnGhost}>Tout lu</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {notifications.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#bbb", fontSize: 13, fontFamily: "sans-serif" }}>Aucune notification</div>}
        {notifications.map(n => {
          const ev = events.find(e => e.id === n.event_id);
          return (
            <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 12, background: n.is_read ? "#fafafa" : typeBg(n.type), border: `1px solid ${n.is_read ? "#eee" : typeColor(n.type) + "33"}` }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: n.is_read ? "#ddd" : typeColor(n.type), marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontFamily: "sans-serif", color: n.is_read ? "#888" : "#333" }}>{n.message}</div>
                {ev && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2, fontFamily: "sans-serif" }}>{ev.name} · {new Date(n.created_at).toLocaleString("fr-FR")}</div>}
              </div>
              <button onClick={() => onDismiss(n.id)} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 18, padding: 0 }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5, fontFamily: "sans-serif" },
  input: { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e5e5e5", fontSize: 13, fontFamily: "sans-serif", outline: "none", background: "#fff", boxSizing: "border-box", color: "#333" },
  btnDark: { background: "#0F0F0F", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif" },
  btnGhost: { background: "transparent", color: "#666", border: "1.5px solid #e5e5e5", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "sans-serif" },
  card: { background: "#f8f8f8", borderRadius: 14, padding: 18, border: "1px solid #eee", marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: 700, marginBottom: 14, fontFamily: "sans-serif" },
};

// ─── APP RACINE ───────────────────────────────────────────────────────────────
export default function App() {
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState("dashboard");
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contributions, setContributions] = useState({});
  const [history, setHistory] = useState([]);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    getSession().then(s => { setUser(s?.user || null); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user || null));
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
      if (cData) allContrib[ev.id] = cData;
      const { data: hData } = await fetchHistory(ev.id);
      if (hData) allHist.push(...hData);
    }
    setExpenses(allExp); setContributions(allContrib); setHistory(allHist);
    const { data: nData } = await fetchNotifications(user.id);
    if (nData) setNotifications(nData);
  }, [user]);

  useEffect(() => { if (user) loadAll(); }, [user, loadAll]);

  useEffect(() => {
    if (!user) return;
    const ch = subscribeToNotifications(user.id, () => {
      fetchNotifications(user.id).then(({ data }) => { if (data) setNotifications(data); });
    });
    return () => unsubscribe(ch);
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    setUser(null); setEvents([]); setExpenses([]); setContributions({}); setHistory([]); setNotifications([]);
  };

  if (loading) return <Spinner />;
  if (!user) return <AuthScreen onAuth={setUser} />;

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const props = { events, expenses, contributions, user, reload: loadAll, isMobile };

  const pages = {
    dashboard:     <Dashboard {...props} />,
    events:        <Events {...props} />,
    expenses:      <Expenses {...props} />,
    balance:       <Balance {...props} />,
    analytics:     <Analytics {...props} />,
    history:       <History events={events} history={history} user={user} reload={loadAll} isMobile={isMobile} />,
    invite:        <Invite events={events} user={user} isMobile={isMobile} />,
    notifications: <NotificationsPage notifications={notifications} events={events} isMobile={isMobile}
                     onMarkAll={async () => { await markAllNotificationsRead(user.id); await loadAll(); }}
                     onDismiss={async (id) => { await deleteNotification(id); await loadAll(); }} />,
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f4f4f4" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <Sidebar active={active} setActive={setActive} unreadCount={unreadCount} user={user} onSignOut={handleSignOut} isMobile={isMobile} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      <main style={{
        flex: 1,
        overflow: "auto",
        padding: isMobile ? "72px 16px 80px" : "32px 36px",
        maxWidth: "100%",
      }}>
        {pages[active]}
      </main>
    </div>
  );
}
