import { useState, useEffect, useCallback } from "react";
import {
  supabase, signUp, signIn, signOut, getSession,
  fetchEvents, createEvent, updateEventStatus, deleteEvent,
  addParticipant, removeParticipant,
  fetchExpenses, createExpense, updateExpense, deleteExpense,
  fetchContributions, upsertContribution,
  fetchHistory, invalidateHistory,
  fetchNotifications, markAllNotificationsRead, deleteNotification,
  fetchInvitations, sendInvitation, removeInvitation, updateInvitationRole, acceptInvitation,
  submitPendingAction, fetchAllPendingActions, approvePendingAction, rejectPendingAction,
  sendGuestCode, verifyGuestCode, fetchGuestEvents, fetchGuestEventDetails,
  subscribeToNotifications, subscribeToPendingActions, unsubscribe,
  exportPDF,
} from "./supabase.js";

// ─── CONSTANTES ───────────────────────────────────────────────
const CATEGORIES = {
  Nourriture:  { icon: "🍽️", color: "#E8F5E9", accent: "#2E7D32", subs: ["Entrée", "Plat", "Dessert"] },
  Boisson:     { icon: "🥤", color: "#E3F2FD", accent: "#1565C0", subs: ["Alcool", "Jus", "Eau", "Autre"] },
  Transport:   { icon: "🚖", color: "#FFF8E1", accent: "#F57F17", subs: ["Taxi", "Tram", "Bus", "Autre"] },
  Accessoires: { icon: "🎉", color: "#F3E5F5", accent: "#6A1B9A", subs: ["Décoration", "Matériel", "Autre"] },
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

// ─── LOGIQUE MÉTIER ───────────────────────────────────────────
const currencySymbol = (c) => c?.split(" ")[1] || "€";

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

// ─── UI HELPERS ───────────────────────────────────────────────
function Avatar({ name = "?", size = 32 }) {
  const colors = ["#2E7D32", "#1565C0", "#F57F17", "#6A1B9A", "#C62828", "#00695C", "#AD1457"];
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: colors[name.charCodeAt(0) % colors.length], color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, flexShrink: 0 }}>
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
      {rest > 0 && <span style={{ marginLeft: 6, fontSize: 11, color: "#aaa" }}>+{rest}</span>}
    </div>
  );
}

function ParticipantInput({ participants, onChange }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const name = input.trim();
    if (!name) return;
    if (participants.map(p => p.toLowerCase()).includes(name.toLowerCase())) { setError("Déjà dans la liste."); return; }
    onChange([...participants, name]); setInput(""); setError("");
  };
  const remove = (name) => onChange(participants.filter(p => p !== name));
  return (
    <div>
      <label style={S.label}>Participants (min. 2)</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input style={{ ...S.input, flex: 1 }} placeholder="Prénom + Entrée" value={input}
          onChange={e => { setInput(e.target.value); setError(""); }}
          onKeyDown={e => e.key === "Enter" && add()} />
        <button onClick={add} style={{ ...S.btnDark, padding: "9px 14px", borderRadius: 8, flexShrink: 0 }}>+</button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#C62828", marginBottom: 6 }}>{error}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {participants.map(p => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 6, background: "#0F0F0F", color: "#fff", borderRadius: 20, padding: "4px 12px", fontSize: 13 }}>
            <Avatar name={p} size={18} />{p}
            <button onClick={() => remove(p)} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
          </div>
        ))}
      </div>
      {participants.length > 0 && participants.length < 2 && <div style={{ fontSize: 12, color: "#F57F17", marginTop: 6 }}>⚠️ Minimum 2 participants</div>}
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
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 20, border: `1.5px solid ${sel ? "#0F0F0F" : "#ddd"}`, background: sel ? "#0F0F0F" : "#fff", color: sel ? "#fff" : "#555", cursor: "pointer", fontSize: 12.5, fontWeight: 500 }}>
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
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
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
      <p style={{ fontSize: 14, marginBottom: 12 }}>{message}</p>
      {warnings.map((w, i) => <div key={i} style={{ background: "#FFF8E1", border: "1px solid #F57F17", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#F57F17", marginBottom: 8 }}>⚠️ {w}</div>)}
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
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────
function AuthScreen({ onAuth, onGuestAuth }) {
  const [mode, setMode] = useState("login"); // login | register | guest | guest_verify | confirm
  const [form, setForm] = useState({ email: "", password: "", name: "", code: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [guestCode, setGuestCode] = useState("");

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
    // Vérifier que cet email a bien une invitation

const { data: invites } = await supabase
  .from('invitations')
  .select('*')
  .eq('email', form.email);
if (!invites || invites.length === 0) { 
  setError("Aucune invitation trouvée pour cet email."); 
  setLoading(false); 
  return; 
}

    // Générer et envoyer le code (pour l'instant on l'affiche en alert pour test)
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await supabase.from('guest_codes').upsert({ email: form.email, code }, { onConflict: 'email' });
    setGuestCode(code); // À remplacer par vrai email en production
    alert(`[MODE TEST] Votre code d'accès est : ${code}\nEn production, il sera envoyé par email.`);
    setMode("guest_verify");
    setLoading(false);
  };

  const handleGuestVerify = async () => {
    setLoading(true); setError("");
    const { valid } = await verifyGuestCode(form.email, form.code);
    if (!valid) { setError("Code incorrect."); setLoading(false); return; }
    // Accepter les invitations de cet email
    await supabase.from('invitations').update({ status: 'accepted' }).eq('email', form.email).eq('status', 'pending');
    onGuestAuth(form.email);
    setLoading(false);
  };

  if (mode === "confirm") return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f4f4f4", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: "100%", maxWidth: 380, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>📧</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Vérifiez votre email</div>
        <p style={{ color: "#888", fontSize: 14 }}>Lien envoyé à <strong>{form.email}</strong>.</p>
        <button onClick={() => setMode("login")} style={{ ...S.btnDark, marginTop: 20, width: "100%" }}>Se connecter</button>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f4f4f4", padding: 16 }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: "100%", maxWidth: 400, boxShadow: "0 4px 30px rgba(0,0,0,0.08)" }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 700, marginBottom: 4 }}>SplitLy</div>
        <div style={{ color: "#888", fontSize: 13, marginBottom: 24 }}>Gestion de dépenses partagées</div>

        {/* Sélecteur de mode */}
        {(mode === "login" || mode === "register" || mode === "guest" || mode === "guest_verify") && (
          <div style={{ display: "flex", background: "#f5f5f5", borderRadius: 10, padding: 4, marginBottom: 24, gap: 4 }}>
            <button onClick={() => { setMode("login"); setError(""); }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: (mode === "login" || mode === "register") ? "#0F0F0F" : "transparent", color: (mode === "login" || mode === "register") ? "#fff" : "#666", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Admin
            </button>
            <button onClick={() => { setMode("guest"); setError(""); }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: (mode === "guest" || mode === "guest_verify") ? "#0F0F0F" : "transparent", color: (mode === "guest" || mode === "guest_verify") ? "#fff" : "#666", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Invité
            </button>
          </div>
        )}

        {/* Formulaire Admin */}
        {(mode === "login" || mode === "register") && (
          <>
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
                onKeyDown={e => e.key === "Enter" && handleAdmin()} />
            </div>
            {error && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#C62828", marginBottom: 14 }}>{error}</div>}
            <button onClick={handleAdmin} disabled={loading} style={{ ...S.btnDark, width: "100%", display: "flex", justifyContent: "center", opacity: loading ? 0.7 : 1 }}>
              {loading ? "..." : mode === "login" ? "Se connecter" : "Créer le compte"}
            </button>
            <div style={{ textAlign: "center", marginTop: 14, fontSize: 13, color: "#888" }}>
              {mode === "login" ? "Pas de compte ? " : "Déjà un compte ? "}
              <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
                style={{ background: "none", border: "none", color: "#0F0F0F", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                {mode === "login" ? "S'inscrire" : "Se connecter"}
              </button>
            </div>
          </>
        )}

        {/* Formulaire Invité - étape 1 */}
        {mode === "guest" && (
          <>
            <div style={{ background: "#E3F2FD", borderRadius: 10, padding: "12px 14px", marginBottom: 20, fontSize: 13, color: "#1565C0" }}>
              Entrez votre email pour recevoir un code d'accès.
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Votre email</label>
              <input style={S.input} type="email" placeholder="votre@email.com" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                onKeyDown={e => e.key === "Enter" && handleGuestRequest()} />
            </div>
            {error && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#C62828", marginBottom: 14 }}>{error}</div>}
            <button onClick={handleGuestRequest} disabled={loading} style={{ ...S.btnDark, width: "100%", display: "flex", justifyContent: "center", opacity: loading ? 0.7 : 1 }}>
              {loading ? "..." : "Recevoir le code"}
            </button>
          </>
        )}

        {/* Formulaire Invité - étape 2 */}
        {mode === "guest_verify" && (
          <>
            <div style={{ background: "#E8F5E9", borderRadius: 10, padding: "12px 14px", marginBottom: 20, fontSize: 13, color: "#2E7D32" }}>
              Code envoyé à <strong>{form.email}</strong>. Entrez-le ci-dessous.
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Code d'accès (6 chiffres)</label>
              <input style={{ ...S.input, fontSize: 20, letterSpacing: 6, textAlign: "center" }} placeholder="000000"
                maxLength={6} value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
                onKeyDown={e => e.key === "Enter" && handleGuestVerify()} />
            </div>
            {error && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#C62828", marginBottom: 14 }}>{error}</div>}
            <button onClick={handleGuestVerify} disabled={loading} style={{ ...S.btnDark, width: "100%", display: "flex", justifyContent: "center", opacity: loading ? 0.7 : 1 }}>
              {loading ? "..." : "Accéder"}
            </button>
            <button onClick={() => setMode("guest")} style={{ ...S.btnGhost, width: "100%", marginTop: 8, display: "flex", justifyContent: "center" }}>Retour</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── GUEST VIEW ───────────────────────────────────────────────
function GuestView({ guestEmail, onSignOut, isMobile }) {
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contributions, setContributions] = useState({});
  const [active, setActive] = useState("events");
  const [loading, setLoading] = useState(true);
  const [pendingForm, setPendingForm] = useState(null);
  const [saving, setSaving] = useState(false);

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
    setSaving(false); setPendingForm(null);
    alert("Votre demande a été envoyée à l'admin. Elle sera exécutée dès approbation.");
  };

  if (loading) return <Spinner />;

  const navItems = [{ key: "events", icon: "◉", label: "Événements" }, { key: "expenses", icon: "◫", label: "Charges" }, { key: "balance", icon: "⊜", label: "Répartition" }];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#f4f4f4" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      {/* Header */}
      <div style={{ background: "#0F0F0F", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: "#fff" }}>SplitLy</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ background: "#1565C0", color: "#fff", fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600 }}>Invité</span>
          <span style={{ color: "#aaa", fontSize: 12 }}>{guestEmail}</span>
          <button onClick={onSignOut} style={{ background: "none", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer" }}>Quitter</button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ background: "#fff", borderBottom: "1px solid #eee", display: "flex", gap: 0 }}>
        {navItems.map(n => (
          <button key={n.key} onClick={() => setActive(n.key)} style={{ padding: "12px 20px", border: "none", background: "none", fontSize: 13, fontWeight: active === n.key ? 700 : 400, color: active === n.key ? "#0F0F0F" : "#888", cursor: "pointer", borderBottom: active === n.key ? "2px solid #0F0F0F" : "2px solid transparent" }}>
            {n.icon} {n.label}
          </button>
        ))}
      </div>

      <main style={{ flex: 1, padding: isMobile ? "20px 16px" : "28px 32px", maxWidth: 900, width: "100%", margin: "0 auto" }}>
        {/* Bandeau lecture seule */}
        <div style={{ background: "#E3F2FD", border: "1px solid #90CAF9", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 13, color: "#1565C0" }}>
          👁 Vous êtes en mode invité. Vous pouvez consulter les données. Pour ajouter une charge, soumettez une demande à l'admin.
        </div>

        {active === "events" && (
          <div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Événements partagés</h2>
            {events.length === 0 && <div style={{ color: "#bbb", fontSize: 14 }}>Aucun événement partagé avec vous.</div>}
            {events.map(ev => {
              const participants = (ev.event_participants || []).map(p => p.name);
              const evTotal = expenses.filter(e => e.event_id === ev.id).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
              return (
                <div key={ev.id} style={{ background: "#fff", borderRadius: 14, padding: "16px 20px", border: "1px solid #eee", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 24 }}>{ev.status === "closed" ? "🔒" : "🎊"}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{ev.name}</div>
                      <div style={{ fontSize: 12, color: "#888" }}>{ev.date} · {participants.length} participants · {currencySymbol(ev.currency)}</div>
                      <AvatarStack names={participants} size={22} />
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{evTotal.toFixed(2)} {currencySymbol(ev.currency)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {active === "expenses" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700 }}>Charges</h2>
              <button onClick={() => setPendingForm("expense")} style={S.btnDark}>+ Demander ajout</button>
            </div>

            {pendingForm === "expense" && (
              <GuestExpenseForm events={events} onSubmit={handleRequestAction} onCancel={() => setPendingForm(null)} saving={saving} />
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {expenses.length === 0 && <div style={{ color: "#bbb", fontSize: 14 }}>Aucune charge.</div>}
              {expenses.map(ex => {
                const cat = CATEGORIES[ex.category];
                const ev = events.find(e => e.id === ex.event_id);
                const t = ex.qty * (ex.unit_price ?? 0);
                const inc = ex.included || [];
                const share = inc.length > 0 ? t / inc.length : 0;
                return (
                  <div key={ex.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #eee" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{cat?.icon}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{ex.detail}</div>
                          <div style={{ fontSize: 11, color: "#aaa" }}>{ev?.name} · par {ex.paid_by}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{t.toFixed(2)}</div>
                        <div style={{ fontSize: 11, color: "#2E7D32" }}>{share.toFixed(2)}/p.</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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
    <div style={{ ...S.card, marginBottom: 16, border: "1.5px solid #1565C0" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, color: "#1565C0" }}>Demande d'ajout de charge</div>
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
      <div style={{ marginBottom: 12 }}><label style={S.label}>Détail</label><input style={S.input} placeholder="Ex: Vin rouge..." value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div><label style={S.label}>Quantité</label><input type="number" min="1" style={S.input} value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
        <div><label style={S.label}>Prix unitaire</label><input type="number" min="0" step="0.01" style={S.input} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
        <div><label style={S.label}>Total</label><div style={{ ...S.input, background: "#f0faf4", color: "#2E7D32", fontWeight: 700, display: "flex", alignItems: "center" }}>{total.toFixed(2)}</div></div>
      </div>
      {currentEvent && <div style={{ marginBottom: 14 }}><ParticipantToggle people={participants} selected={form.included} onChange={p => setForm({ ...form, included: p })} label="Qui partage ?" /></div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onSubmit("add_expense", { ...form, qty: Number(form.qty), unit: Number(form.unit) }, form.eventId)} disabled={saving || !form.eventId || !form.detail || total === 0} style={S.btnDark}>{saving ? "..." : "Soumettre la demande"}</button>
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
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {events.map(ev => <button key={ev.id} onClick={() => setSel(ev.id)} style={{ padding: "6px 14px", borderRadius: 20, border: `1.5px solid ${sel === ev.id ? "#0F0F0F" : "#ddd"}`, background: sel === ev.id ? "#0F0F0F" : "#fff", color: sel === ev.id ? "#fff" : "#555", fontSize: 12, cursor: "pointer" }}>{ev.name}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
        {participants.map(p => {
          const owed = computeOwed(evExp, p);
          const contrib = evContribMap[p] || 0;
          const net = contrib - owed;
          const settled = isSettled(net);
          return (
            <div key={p} style={{ background: "#fff", borderRadius: 12, padding: "14px 12px", border: `1.5px solid ${settled ? "#c8e6c9" : "#eee"}`, textAlign: "center" }}>
              <Avatar name={p} size={32} />
              <div style={{ marginTop: 7, fontSize: 13, fontWeight: 700 }}>{p}</div>
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 3 }}>Doit: {owed.toFixed(2)}</div>
              <div style={{ marginTop: 5, fontSize: 13, fontWeight: 700, color: settled ? "#2E7D32" : net > 0 ? "#1565C0" : "#C62828" }}>
                {settled ? "✓ Soldé" : net > 0 ? `+${net.toFixed(2)}` : `${net.toFixed(2)} ${sym}`}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", fontSize: 13, fontWeight: 700 }}>Remboursements ({transactions.length})</div>
        {transactions.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#bbb", fontSize: 13 }}>✓ Tout est soldé !</div>}
        {transactions.map((t, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: i < transactions.length - 1 ? "1px solid #f5f5f5" : "none" }}>
            <Avatar name={t.from} size={26} />
            <div style={{ flex: 1, fontSize: 13 }}><span style={{ fontWeight: 600 }}>{t.from}</span> → <span style={{ fontWeight: 600 }}>{t.to}</span></div>
            <Avatar name={t.to} size={26} />
            <div style={{ fontSize: 14, fontWeight: 700 }}>{t.amount.toFixed(2)} {sym}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ADMIN SIDEBAR ────────────────────────────────────────────
function Sidebar({ active, setActive, unreadCount, pendingCount, user, onSignOut, isMobile, menuOpen, setMenuOpen }) {
  const nav = [
    { key: "dashboard",     icon: "◈", label: "Tableau de bord" },
    { key: "events",        icon: "◉", label: "Événements" },
    { key: "expenses",      icon: "◫", label: "Charges" },
    { key: "balance",       icon: "⊜", label: "Répartition" },
    { key: "analytics",     icon: "◐", label: "Analyses" },
    { key: "history",       icon: "◷", label: "Historique" },
    { key: "invite",        icon: "◎", label: "Inviter" },
    { key: "notifications", icon: "◬", label: "Notifications", badge: unreadCount + pendingCount },
  ];

  if (isMobile) {
    return (
      <>
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 56, background: "#0F0F0F", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", zIndex: 200 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, color: "#fff" }}>SplitLy</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {(unreadCount + pendingCount) > 0 && <span style={{ background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "2px 7px" }}>{unreadCount + pendingCount}</span>}
            <button onClick={() => setMenuOpen(!menuOpen)} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer" }}>☰</button>
          </div>
        </div>
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
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: active === n.key ? "#1a1a1a" : "transparent", color: active === n.key ? "#fff" : "#666", fontSize: 14, fontWeight: active === n.key ? 600 : 400, textAlign: "left", width: "100%" }}>
                    <span style={{ fontSize: 16 }}>{n.icon}</span>
                    <span style={{ flex: 1 }}>{n.label}</span>
                    {n.badge > 0 && <span style={{ background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>{n.badge}</span>}
                  </button>
                ))}
              </div>
              <div style={{ padding: "16px", borderTop: "1px solid #1e1e1e" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Avatar name={user?.user_metadata?.full_name?.[0] || user?.email?.[0] || "U"} size={28} />
                  <div style={{ color: "#fff", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.user_metadata?.full_name || user?.email}</div>
                </div>
                <button onClick={onSignOut} style={{ width: "100%", padding: "7px", borderRadius: 8, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontSize: 12, cursor: "pointer" }}>Déconnexion</button>
              </div>
            </div>
          </div>
        )}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 60, background: "#0F0F0F", display: "flex", alignItems: "center", justifyContent: "space-around", zIndex: 200, borderTop: "1px solid #1e1e1e" }}>
          {nav.slice(0, 5).map(n => (
            <button key={n.key} onClick={() => setActive(n.key)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, background: "none", border: "none", cursor: "pointer", color: active === n.key ? "#fff" : "#555", padding: "6px 8px", position: "relative" }}>
              <span style={{ fontSize: 18 }}>{n.icon}</span>
              <span style={{ fontSize: 9 }}>{n.label.split(" ")[0]}</span>
              {n.badge > 0 && <span style={{ position: "absolute", top: 2, right: 2, background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 9, fontWeight: 700, padding: "0 4px" }}>{n.badge}</span>}
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <aside style={{ width: 220, background: "#0F0F0F", display: "flex", flexDirection: "column", padding: "28px 0", flexShrink: 0 }}>
      <div style={{ padding: "0 22px 24px", borderBottom: "1px solid #1e1e1e" }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: "#fff" }}>SplitLy</div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>Gestion de dépenses</div>
      </div>
      <div style={{ padding: "16px 10px 0", flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {nav.map(n => (
          <button key={n.key} onClick={() => setActive(n.key)}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: active === n.key ? "#1a1a1a" : "transparent", color: active === n.key ? "#fff" : "#666", fontSize: 13, fontWeight: active === n.key ? 600 : 400, textAlign: "left" }}>
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
            <div style={{ color: "#fff", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.user_metadata?.full_name || user?.email}</div>
            <div style={{ color: "#F57F17", fontSize: 10 }}>Admin</div>
          </div>
        </div>
        <button onClick={onSignOut} style={{ width: "100%", padding: "6px", borderRadius: 8, border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontSize: 11, cursor: "pointer" }}>Déconnexion</button>
      </div>
    </aside>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────
function Dashboard({ events, expenses, user, isMobile }) {
  const name = user?.user_metadata?.full_name?.split(" ")[0] || "vous";
  const byCategory = Object.keys(CATEGORIES).map(cat => ({
    cat, total: expenses.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0),
  })).filter(c => c.total > 0);
  const grandTotal = expenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);

  return (
    <div>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 6 }}>Bonjour, {name} 👋</h2>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 20 }}>Résumé de tous vos événements.</p>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Budget total collectif", value: `${grandTotal.toFixed(2)} €`, sub: `${expenses.length} charges · tous événements` },
          { label: "Événements", value: events.length, sub: `${events.filter(e => e.status === "open").length} ouvert(s) · ${events.filter(e => e.status === "closed").length} bouclé(s)` },
          { label: "Participants uniques", value: [...new Set(events.flatMap(e => (e.event_participants || []).map(p => p.name)))].length, sub: "sur tous les événements" },
        ].map((c, idx) => (
          <div key={c.label} style={{ background: "#f8f8f8", borderRadius: 12, padding: 16, border: "1px solid #eee", gridColumn: isMobile && idx === 2 ? "1 / -1" : "auto" }}>
            <div style={{ fontSize: 10, color: "#888", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{c.label}</div>
            <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{c.value}</div>
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
        <div style={{ background: "#f8f8f8", borderRadius: 14, padding: 16, border: "1px solid #eee" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Par catégorie (tous événements)</div>
          {byCategory.length === 0 && <div style={{ color: "#ccc", fontSize: 13 }}>Aucune charge</div>}
          {byCategory.map(c => (
            <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 16 }}>{CATEGORIES[c.cat].icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12 }}>{c.cat}</span>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{c.total.toFixed(2)} €</span>
                </div>
                <div style={{ background: "#e5e5e5", borderRadius: 4, height: 5 }}>
                  <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 4, height: 5, width: `${grandTotal > 0 ? (c.total / grandTotal) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: "#f8f8f8", borderRadius: 14, padding: 16, border: "1px solid #eee" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Événements récents</div>
          {events.length === 0 && <div style={{ color: "#ccc", fontSize: 13 }}>Aucun événement</div>}
          {events.slice(0, 5).map(ev => {
            const evTotal = expenses.filter(e => e.event_id === ev.id).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
            const participants = (ev.event_participants || []).map(p => p.name);
            return (
              <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: "#fff", border: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{ev.status === "closed" ? "🔒" : "🎊"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{ev.date} · {participants.length} p. · Budget collectif</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{evTotal.toFixed(2)} {currencySymbol(ev.currency)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── ÉVÉNEMENTS ───────────────────────────────────────────────
function Events({ events, expenses, contributions, user, reload, isMobile }) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", date: "", currency: "EUR €", participants: [] });
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [managingEv, setManagingEv] = useState(null); // événement dont on gère les participants
  const [newParticipant, setNewParticipant] = useState("");

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
      message: `Boucler "${ev.name}" ? L'historique sera effacé et aucune modification ne sera plus possible. Irréversible.`,
      onConfirm: async () => { await updateEventStatus(ev.id, "closed"); await reload(); setConfirm(null); },
      onCancel: () => setConfirm(null),
    });
  };

  const handleAddParticipant = async (ev) => {
    const name = newParticipant.trim();
    if (!name) return;
    const existing = (ev.event_participants || []).map(p => p.name.toLowerCase());
    if (existing.includes(name.toLowerCase())) { alert("Ce participant existe déjà."); return; }
    await addParticipant(ev.id, name);
    await reload(); setNewParticipant("");
  };

  const handleRemoveParticipant = (ev, name) => {
    setConfirm({
      message: `Retirer "${name}" de l'événement "${ev.name}" ? Ses contributions seront retirées et les calculs recalculés.`,
      onConfirm: async () => {
        await removeParticipant(ev.id, name);
        await reload(); setConfirm(null);
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
            {(managingEv.event_participants || []).map(p => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
                <Avatar name={p.name} size={28} />
                <span style={{ flex: 1, fontSize: 14 }}>{p.name}</span>
                {managingEv.status === "open" && (
                  <button onClick={() => { setManagingEv(null); handleRemoveParticipant(managingEv, p.name); }} style={{ padding: "3px 10px", borderRadius: 6, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Retirer</button>
                )}
              </div>
            ))}
          </div>
          {managingEv.status === "open" && (
            <div>
              <label style={S.label}>Ajouter un participant</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...S.input, flex: 1 }} placeholder="Prénom" value={newParticipant}
                  onChange={e => setNewParticipant(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddParticipant(managingEv)} />
                <button onClick={() => handleAddParticipant(managingEv)} style={{ ...S.btnDark, padding: "9px 14px" }}>+</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 2 }}>Événements</h2>
          <p style={{ color: "#888", fontSize: 12 }}>{events.length} événement(s)</p>
        </div>
        <button onClick={() => setShowNew(!showNew)} style={S.btnDark}>+ Nouveau</button>
      </div>

      {showNew && (
        <div style={S.card}>
          <div style={S.sectionTitle}>Créer un événement</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div><label style={S.label}>Nom</label><input style={S.input} placeholder="Soirée chez Marc" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label style={S.label}>Date</label><input type="date" style={S.input} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
              <label style={S.label}>Monnaie</label>
              <select style={{ ...S.input, maxWidth: 200 }} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <ParticipantInput participants={form.participants} onChange={p => setForm({ ...form, participants: p })} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleCreate} disabled={loading || form.participants.length < 2} style={{ ...S.btnDark, opacity: form.participants.length < 2 ? 0.5 : 1 }}>{loading ? "..." : "Créer"}</button>
            <button onClick={() => setShowNew(false)} style={S.btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {events.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#bbb", fontSize: 14 }}>Aucun événement. Créez-en un !</div>}
        {events.map(ev => {
          const participants = (ev.event_participants || []).map(p => p.name);
          const evExp = expenses.filter(e => e.event_id === ev.id);
          const evContribMap = {};
          (contributions[ev.id] || []).forEach(c => { evContribMap[c.participant] = c.amount; });
          const evTotal = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
          const settledCount = participants.filter(p => isSettled(computeNetBalance(evExp, evContribMap, p))).length;
          const allSettled = participants.length > 0 && settledCount === participants.length;
          const progress = participants.length > 0 ? (settledCount / participants.length) * 100 : 0;

          return (
            <div key={ev.id} style={{ background: "#fff", borderRadius: 14, padding: isMobile ? "14px 16px" : "16px 20px", border: "1px solid #eee" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: ev.status === "closed" ? "#f5f5f5" : "#f0faf4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{ev.status === "closed" ? "🔒" : "🎊"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{ev.name}</span>
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: ev.status === "closed" ? "#f0f0f0" : "#E8F5E9", color: ev.status === "closed" ? "#999" : "#2E7D32", fontWeight: 600 }}>
                      {ev.status === "closed" ? "Bouclé" : "Ouvert"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>📅 {ev.date} · {currencySymbol(ev.currency)} · Budget collectif : {evTotal.toFixed(2)}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <AvatarStack names={participants} size={22} />
                    <button onClick={() => setManagingEv(ev)} style={{ fontSize: 11, color: "#1565C0", background: "none", border: "1px solid #90CAF9", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                      Gérer participants
                    </button>
                  </div>
                  {/* Barre de progression vers bouclage */}
                  {ev.status === "open" && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: 11, color: "#888" }}>Progression bouclage</span>
                        <span style={{ fontSize: 11, color: allSettled ? "#2E7D32" : "#888", fontWeight: 600 }}>{settledCount}/{participants.length} soldés</span>
                      </div>
                      <div style={{ background: "#eee", borderRadius: 4, height: 6 }}>
                        <div style={{ background: allSettled ? "#2E7D32" : "#F57F17", borderRadius: 4, height: 6, width: `${progress}%`, transition: "width 0.3s" }} />
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {ev.status === "open" && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {allSettled && (
                        <button onClick={() => handleClose(ev)} style={{ ...S.btnDark, padding: "5px 12px", fontSize: 11, background: "#2E7D32" }}>🔒 Boucler</button>
                      )}
                      <button onClick={() => handleDelete(ev)} style={{ padding: "5px 10px", borderRadius: 7, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Supprimer</button>
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

// ─── CHARGES ──────────────────────────────────────────────────
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
    await reload(); setForm(empty); setEditingEx(null); setShowForm(false); setSaving(false);
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
          <p style={{ color: "#888", fontSize: 12 }}>{expenses.length} dépense(s)</p>
        </div>
        <button onClick={() => { setForm(empty); setEditingEx(null); setShowForm(!showForm); }} style={S.btnDark}>+ Ajouter</button>
      </div>
      <div style={{ marginBottom: 14 }}>
        <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          <option value="all">Tous les événements</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
      </div>

      {showForm && (
        <div style={S.card}>
          <div style={S.sectionTitle}>{editingEx ? "Modifier" : "Nouvelle charge"}</div>
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
          <div style={{ marginBottom: 12 }}><label style={S.label}>Détail</label><input style={S.input} placeholder="Ex: Vin rouge..." value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div><label style={S.label}>Quantité</label><input type="number" min="1" style={S.input} value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
            <div><label style={S.label}>Prix unitaire</label><input type="number" min="0" step="0.01" style={S.input} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
            <div><label style={S.label}>Total</label><div style={{ ...S.input, background: "#f0faf4", color: "#2E7D32", fontWeight: 700, display: "flex", alignItems: "center" }}>{total.toFixed(2)}</div></div>
          </div>
          {currentEvent && (
            <div style={{ marginBottom: 14, padding: 14, background: "#fafafa", borderRadius: 10, border: "1px solid #eee" }}>
              <ParticipantToggle people={participants} selected={form.included} onChange={p => setForm({ ...form, included: p })} label="Qui partage ?" />
              {form.included.length > 0 && total > 0 && (
                <div style={{ marginTop: 10, padding: "7px 12px", background: "#E8F5E9", borderRadius: 8, fontSize: 12, color: "#2E7D32", fontWeight: 600 }}>
                  ➗ {sharePerPerson.toFixed(2)} / personne · {form.included.length} inclus
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={S.btnDark}>{saving ? "..." : editingEx ? "Enregistrer" : "Ajouter"}</button>
            <button onClick={() => { setShowForm(false); setEditingEx(null); }} style={S.btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "#bbb", fontSize: 13 }}>Aucune charge</div>}
          {filtered.map(ex => {
            const cat = CATEGORIES[ex.category];
            const ev = events.find(e => e.id === ex.event_id);
            const t = ex.qty * (ex.unit_price ?? 0);
            const inc = ex.included || [];
            const share = inc.length > 0 ? t / inc.length : 0;
            return (
              <div key={ex.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #eee" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{cat?.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{ex.detail}</div>
                      <div style={{ fontSize: 11, color: "#aaa" }}>{ev?.name} · par {ex.paid_by}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{t.toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: "#2E7D32" }}>{share.toFixed(2)}/p.</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {cat && <Badge label={ex.sub_category} color={cat.color} accent={cat.accent} />}
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
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
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
                const inc = ex.included || [];
                const share = inc.length > 0 ? t / inc.length : 0;
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
                    <td style={{ padding: "9px 10px" }}><AvatarStack names={inc} size={18} /></td>
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

// ─── RÉPARTITION ─────────────────────────────────────────────
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
    await reload(); setSaving(false); setSettleModal(null);
  };

  const handleVersement = async (person) => {
    const amount = parseFloat(versement[person] || 0);
    if (!amount || amount <= 0) return;
    const current = evContribMap[person] || 0;
    setSaving(true);
    await upsertContribution(filterEvent, person, current + amount, user.id);
    await reload(); setVersement(v => ({ ...v, [person]: "" })); setSaving(false);
  };

  const transactions = participants.length > 0 ? computeTransactions(evExp, evContribMap, participants) : [];

  const handleExportPDF = () => {
    if (!ev) return;
    exportPDF(ev, evExp, evContribMap, participants);
  };

  return (
    <div>
      {settleModal && (
        <Modal title={`Solder ${settleModal.person}`} onClose={() => setSettleModal(null)}>
          <p style={{ fontSize: 14, marginBottom: 16 }}>{settleModal.message}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={confirmSettle} disabled={saving} style={S.btnDark}>{saving ? "..." : "Confirmer"}</button>
            <button onClick={() => setSettleModal(null)} style={S.btnGhost}>Annuler</button>
          </div>
        </Modal>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 2 }}>Répartition</h2>
          <p style={{ color: "#888", fontSize: 12 }}>Soldes en temps réel</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <button onClick={handleExportPDF} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 12 }}>📄 PDF</button>
        </div>
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
              <div style={{ marginTop: 7, fontSize: 13, fontWeight: 700 }}>{p}</div>
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 3 }}>Doit: {owed.toFixed(2)} {sym}</div>
              <div style={{ fontSize: 10, color: "#aaa" }}>Versé: {contrib.toFixed(2)} {sym}</div>
              <div style={{ marginTop: 5, fontSize: 13, fontWeight: 700, color: settled ? "#2E7D32" : net > 0 ? "#1565C0" : "#C62828" }}>
                {settled ? "✓ Soldé" : net > 0 ? `+${net.toFixed(2)} trop` : `${net.toFixed(2)} ${sym}`}
              </div>
              {!settled && ev?.status === "open" && (
                <div style={{ marginTop: 8, display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                  <input type="number" placeholder="Montant" style={{ ...S.input, width: 65, padding: "4px 6px", fontSize: 11 }} value={versement[p] || ""} onChange={e => setVersement(v => ({ ...v, [p]: e.target.value }))} />
                  <button onClick={() => handleVersement(p)} disabled={saving} style={{ ...S.btnDark, padding: "4px 8px", fontSize: 11 }}>+</button>
                  <button onClick={() => handleSettle(p)} style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid #2E7D32", background: "#E8F5E9", color: "#2E7D32", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Solder</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", fontSize: 13, fontWeight: 700 }}>Remboursements ({transactions.length})</div>
        {transactions.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#bbb", fontSize: 13 }}>✓ Tout est soldé !</div>}
        {transactions.map((t, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: i < transactions.length - 1 ? "1px solid #f5f5f5" : "none" }}>
            <Avatar name={t.from} size={26} />
            <div style={{ flex: 1, fontSize: 13 }}><span style={{ fontWeight: 600 }}>{t.from}</span> → <span style={{ fontWeight: 600 }}>{t.to}</span></div>
            <Avatar name={t.to} size={26} />
            <div style={{ fontSize: 14, fontWeight: 700 }}>{t.amount.toFixed(2)} {sym}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ANALYSES ─────────────────────────────────────────────────
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
          <button key={ev.id} onClick={() => setSel(ev.id)} style={{ padding: "6px 12px", borderRadius: 20, border: `1.5px solid ${sel === ev.id ? "#0F0F0F" : "#ddd"}`, background: sel === ev.id ? "#0F0F0F" : "#fff", color: sel === ev.id ? "#fff" : "#555", fontSize: 12, cursor: "pointer" }}>
            {ev.name}
          </button>
        ))}
      </div>
      {ev && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Budget collectif", value: `${budget.toFixed(2)} ${sym}`, sub: `${evExp.length} charges · total groupe` },
              { label: "Participants", value: participants.length, sub: `Part moy. ${participants.length > 0 ? (budget / participants.length).toFixed(2) : 0} ${sym}/p.` },
              { label: "Statut", value: ev.status === "closed" ? "Bouclé 🔒" : "Ouvert", sub: ev.date },
            ].map((c, idx) => (
              <div key={c.label} style={{ background: "#f8f8f8", borderRadius: 12, padding: 14, border: "1px solid #eee", gridColumn: isMobile && idx === 2 ? "1 / -1" : "auto" }}>
                <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{c.value}</div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{c.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Par catégorie</div>
              {byCategory.length === 0 && <div style={{ color: "#ccc", fontSize: 13 }}>Aucune charge</div>}
              {byCategory.map(c => (
                <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>{CATEGORIES[c.cat].icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 12 }}>{c.cat}</span>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{c.total.toFixed(2)} ({budget > 0 ? ((c.total / budget) * 100).toFixed(0) : 0}%)</span>
                    </div>
                    <div style={{ background: "#eee", borderRadius: 4, height: 5 }}>
                      <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 4, height: 5, width: `${budget > 0 ? (c.total / budget) * 100 : 0}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Part due par participant</div>
              {participants.map(p => {
                const owed = computeOwed(evExp, p);
                const paid = evContribMap[p] || 0;
                return (
                  <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <Avatar name={p} size={26} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{p}</div>
                      <div style={{ fontSize: 10, color: "#aaa" }}>Part due: {owed.toFixed(2)} · Versé: {paid.toFixed(2)} {sym}</div>
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

// ─── HISTORIQUE ───────────────────────────────────────────────
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
          <p style={{ color: "#888", fontSize: 12 }}>Modifications · Rollback disponible</p>
        </div>
        <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          <option value="all">Tous</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" }}>
        {filtered.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#bbb", fontSize: 13 }}>Aucune modification</div>}
        {[...filtered].reverse().map((h, i) => {
          const ev = events.find(e => e.id === h.event_id);
          const color = h.invalidated ? "#ccc" : h.action.includes("supprim") ? "#C62828" : h.action.includes("ajout") || h.action.includes("créé") ? "#2E7D32" : "#1565C0";
          return (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: i < filtered.length - 1 ? "1px solid #f5f5f5" : "none", opacity: h.invalidated ? 0.4 : 1 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.action} {h.invalidated && <span style={{ fontSize: 10, color: "#aaa", fontWeight: 400 }}>(invalidé)</span>}
                </div>
                <div style={{ fontSize: 11, color: "#aaa" }}>{ev?.name || "–"} · {new Date(h.created_at).toLocaleString("fr-FR")}</div>
              </div>
              {!h.invalidated && ev?.status === "open" && (
                <button onClick={() => handleRollback(h)} style={{ padding: "4px 10px", borderRadius: 6, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>↩ Invalider</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── INVITATIONS ──────────────────────────────────────────────
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
    await loadInvites(); setSaving(false);
  };

  const handleRemove = async (inv) => {
    await removeInvitation(inv.event_id, inv.email);
    await loadInvites();
  };

  const handleToggleRole = async (inv) => {
    const newRole = inv.role === "read" ? "edit" : "read";
    await updateInvitationRole(inv.event_id, inv.email, newRole);
    await loadInvites();
  };

  return (
    <div>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 4 }}>Invitations</h2>
      <p style={{ color: "#888", fontSize: 12, marginBottom: 20 }}>Gérez l'accès de vos invités</p>
      <div style={S.card}>
        <div style={S.sectionTitle}>Inviter quelqu'un</div>
        <div style={{ background: "#E8F5E9", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#2E7D32" }}>
          📧 L'invité recevra un code d'accès par email. Il pourra se connecter depuis la page d'accueil en mode "Invité".
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div><label style={S.label}>Email de l'invité</label><input style={S.input} type="email" placeholder="ami@example.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div><label style={S.label}>Niveau d'accès initial</label>
            <select style={S.input} value={role} onChange={e => setRole(e.target.value)}>
              <option value="read">Lecture seule</option>
              <option value="edit">Peut soumettre des charges</option>
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={S.label}>Événements accessibles</label>
          {events.map(ev => (
            <label key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginTop: 8 }}>
              <input type="checkbox" checked={selectedEvents.includes(ev.id)} onChange={() => setSelectedEvents(s => s.includes(ev.id) ? s.filter(x => x !== ev.id) : [...s, ev.id])} />
              {ev.name} <span style={{ color: "#aaa" }}>({ev.date})</span>
            </label>
          ))}
        </div>
        <button onClick={handleSend} disabled={saving} style={S.btnDark}>{saving ? "..." : "Envoyer l'invitation ✉️"}</button>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", fontSize: 13, fontWeight: 700 }}>Invités ({invitations.length})</div>
        {invitations.length === 0 && <div style={{ padding: 20, color: "#bbb", fontSize: 13 }}>Aucune invitation</div>}
        {invitations.map((inv, i) => (
          <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: i < invitations.length - 1 ? "1px solid #f5f5f5" : "none", flexWrap: "wrap" }}>
            <Avatar name={inv.email[0]} size={30} />
            <div style={{ flex: 1, minWidth: 100 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{inv.email}</div>
              <div style={{ fontSize: 11, color: "#aaa" }}>{inv.eventName}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 20, background: inv.status === "accepted" ? "#E8F5E9" : "#FFF8E1", color: inv.status === "accepted" ? "#2E7D32" : "#F57F17" }}>
              {inv.status === "accepted" ? "Accepté" : "En attente"}
            </span>
            <button onClick={() => handleToggleRole(inv)} style={{ padding: "3px 8px", borderRadius: 6, border: `1.5px solid ${inv.role === "edit" ? "#1565C0" : "#ddd"}`, background: inv.role === "edit" ? "#E3F2FD" : "#fff", color: inv.role === "edit" ? "#1565C0" : "#666", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              {inv.role === "edit" ? "✏️ Éditeur" : "👁 Lecture"}
            </button>
            <button onClick={() => handleRemove(inv)} style={{ padding: "3px 8px", borderRadius: 6, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer" }}>Retirer</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── NOTIFICATIONS + DEMANDES EN ATTENTE ──────────────────────
function NotificationsPage({ notifications, events, expenses, pendingActions, user, onMarkAll, onDismiss, reload, isMobile }) {
  const [saving, setSaving] = useState(null);

  const handleApprove = async (action) => {
    setSaving(action.id);
    await approvePendingAction(action.id, user.id, action);
    await reload(); setSaving(null);
  };

  const handleReject = async (action) => {
    setSaving(action.id);
    await rejectPendingAction(action.id, user.id);
    await reload(); setSaving(null);
  };

  const typeColor = (t) => ({ success: "#2E7D32", warning: "#F57F17", info: "#1565C0", request: "#6A1B9A" }[t] || "#888");
  const typeBg = (t) => ({ success: "#E8F5E9", warning: "#FFF8E1", info: "#E3F2FD", request: "#F3E5F5" }[t] || "#f8f8f8");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, marginBottom: 2 }}>Notifications</h2>
          <p style={{ color: "#888", fontSize: 12 }}>{notifications.filter(n => !n.is_read).length} non lue(s) · {pendingActions.length} demande(s) en attente</p>
        </div>
        <button onClick={onMarkAll} style={S.btnGhost}>Tout lu</button>
      </div>

      {/* Demandes en attente des invités */}
      {pendingActions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6A1B9A", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Demandes en attente d'approbation</div>
          {pendingActions.map(action => {
            const ev = events.find(e => e.id === action.event_id);
            const data = action.action_data;
            return (
              <div key={action.id} style={{ background: "#F3E5F5", borderRadius: 12, padding: "14px 16px", border: "1px solid #ce93d8", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ fontSize: 20 }}>📝</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#6A1B9A", marginBottom: 4 }}>
                      {action.guest_email} demande d'ajouter une charge
                    </div>
                    <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>
                      Événement : <strong>{ev?.name}</strong> · {data?.detail} · {((data?.qty || 0) * (data?.unit || 0)).toFixed(2)} {currencySymbol(ev?.currency)}
                    </div>
                    <div style={{ fontSize: 11, color: "#888" }}>
                      Payé par : {data?.paidBy} · Inclus : {(data?.included || []).join(", ")}
                    </div>
                    <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                      Demandé le {new Date(action.created_at).toLocaleString("fr-FR")}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={() => handleApprove(action)} disabled={saving === action.id} style={{ ...S.btnDark, padding: "6px 14px", fontSize: 12, background: "#2E7D32" }}>
                    {saving === action.id ? "..." : "✓ Approuver"}
                  </button>
                  <button onClick={() => handleReject(action)} disabled={saving === action.id} style={{ padding: "6px 14px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                    ✕ Refuser
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Notifications système */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {notifications.length === 0 && pendingActions.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#bbb", fontSize: 13 }}>Aucune notification</div>}
        {notifications.map(n => {
          const ev = events.find(e => e.id === n.event_id);
          return (
            <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 12, background: n.is_read ? "#fafafa" : typeBg(n.type), border: `1px solid ${n.is_read ? "#eee" : typeColor(n.type) + "33"}` }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: n.is_read ? "#ddd" : typeColor(n.type), marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: n.is_read ? "#888" : "#333" }}>{n.message}</div>
                {ev && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{ev.name} · {new Date(n.created_at).toLocaleString("fr-FR")}</div>}
              </div>
              <button onClick={() => onDismiss(n.id)} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 18, padding: 0 }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────
const S = {
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 },
  input: { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid #e5e5e5", fontSize: 13, outline: "none", background: "#fff", boxSizing: "border-box", color: "#333" },
  btnDark: { background: "#0F0F0F", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnGhost: { background: "transparent", color: "#666", border: "1.5px solid #e5e5e5", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  card: { background: "#f8f8f8", borderRadius: 14, padding: 18, border: "1px solid #eee", marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: 700, marginBottom: 14 },
};

// ─── APP RACINE ───────────────────────────────────────────────
export default function App() {
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [guestEmail, setGuestEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState("dashboard");
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contributions, setContributions] = useState({});
  const [history, setHistory] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [pendingActions, setPendingActions] = useState([]);

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
      if (cData) { allContrib[ev.id] = []; cData.forEach(c => { if (!allContrib[ev.id]) allContrib[ev.id] = []; allContrib[ev.id].push(c); }); }
      const { data: hData } = await fetchHistory(ev.id);
      if (hData) allHist.push(...hData);
    }
    setExpenses(allExp);
    setContributions(allContrib);
    setHistory(allHist);
    const { data: nData } = await fetchNotifications(user.id);
    if (nData) setNotifications(nData);
    // Charger les actions en attente
    if (evData.length > 0) {
      const { data: paData } = await fetchAllPendingActions(evData.map(e => e.id));
      if (paData) setPendingActions(paData);
    }
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
    setUser(null); setGuestEmail(null); setEvents([]); setExpenses([]);
    setContributions({}); setHistory([]); setNotifications([]); setPendingActions([]);
  };

  if (loading) return <Spinner />;
  if (!user && !guestEmail) return <AuthScreen onAuth={setUser} onGuestAuth={setGuestEmail} />;
  if (guestEmail) return <GuestView guestEmail={guestEmail} onSignOut={() => setGuestEmail(null)} isMobile={isMobile} />;

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const pendingCount = pendingActions.length;

  // Convertir contributions pour les composants
  const contribForComponents = {};
  Object.entries(contributions).forEach(([evId, arr]) => {
    contribForComponents[evId] = Array.isArray(arr) ? arr : [];
  });

  const props = { events, expenses, contributions: contribForComponents, user, reload: loadAll, isMobile };

  const pages = {
    dashboard:     <Dashboard {...props} />,
    events:        <Events {...props} />,
    expenses:      <Expenses {...props} />,
    balance:       <Balance {...props} />,
    analytics:     <Analytics {...props} />,
    history:       <History events={events} history={history} user={user} reload={loadAll} isMobile={isMobile} />,
    invite:        <Invite events={events} user={user} isMobile={isMobile} />,
    notifications: <NotificationsPage notifications={notifications} events={events} expenses={expenses}
                     pendingActions={pendingActions} user={user} reload={loadAll} isMobile={isMobile}
                     onMarkAll={async () => { await markAllNotificationsRead(user.id); await loadAll(); }}
                     onDismiss={async (id) => { await deleteNotification(id); await loadAll(); }} />,
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f4f4f4" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <Sidebar active={active} setActive={setActive} unreadCount={unreadCount} pendingCount={pendingCount}
        user={user} onSignOut={handleSignOut} isMobile={isMobile} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      <main style={{ flex: 1, overflow: "auto", padding: isMobile ? "72px 16px 80px" : "28px 32px", maxWidth: "100%" }}>
        {pages[active]}
      </main>
    </div>
  );
}
