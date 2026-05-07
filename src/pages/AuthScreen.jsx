// src/pages/AuthScreen.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { signUp, signIn, sendGuestCode, verifyGuestCode } from "../supabase.js";

export function AuthScreen({ onAuth, onGuestAuth, initialMode, onClose }) {
  // Pré-remplir l'email invité si l'URL contient ?guest=email (lien d'invitation)
  const urlGuestEmail = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const g = params.get("guest") || "";
      if (g) {
        // Nettoyer l'URL sans recharger la page
        const clean = window.location.pathname;
        window.history.replaceState({}, "", clean);
      }
      return g;
    } catch { return ""; }
  })();

  const [mode, setMode] = useState(urlGuestEmail ? "guest" : (initialMode || "login"));
  const [form, setForm] = useState({ email: urlGuestEmail, password: "", name: "", code: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState({});

  const touch = (field) => setTouched(t => ({ ...t, [field]: true }));

  const emailValid   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const passwordValid = form.password.length >= 8;
  const nameValid    = form.name.trim().length >= 2;
  const codeValid    = /^\d{6}$/.test(form.code);

  const fieldErr = {
    email:    !emailValid   ? "Email invalide (ex: alice@mail.com)" : "",
    password: !passwordValid? "Minimum 8 caractères" : "",
    name:     !nameValid    ? "Minimum 2 caractères" : "",
    code:     !codeValid    ? "6 chiffres requis" : "",
  };

  const canSubmit = mode === "login"
    ? emailValid && form.password.length > 0
    : emailValid && passwordValid && nameValid;

  const inp = (field) => ({
    ...S.input,
    borderColor: touched[field] && fieldErr[field] ? "#C62828" : touched[field] && !fieldErr[field] ? "#4CAF50" : undefined,
    boxShadow: touched[field] && fieldErr[field] ? "0 0 0 2px #FFCDD2" : touched[field] && !fieldErr[field] ? "0 0 0 2px #C8E6C9" : undefined,
    transition: "border-color 0.2s, box-shadow 0.2s",
  });

  const FErr = ({ field }) => touched[field] && fieldErr[field]
    ? <div style={{ fontSize: 11, color: "#C62828", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>⚠️ {fieldErr[field]}</div>
    : null;

  const handleAdmin = async () => {
    setTouched({ email: true, password: true, name: true });
    if (!canSubmit) return;
    setLoading(true); setError("");
    if (mode === "login") {
      const { data, error } = await signIn(form.email.trim(), form.password);
      if (error) setError(error.message);
      else onAuth(data.user);
    } else {
      const { error } = await signUp(form.email.trim(), form.password, form.name.trim());
      if (error) setError(error.message);
      else setMode("confirm");
    }
    setLoading(false);
  };

  const handleGuestRequest = async () => {
    setTouched(t => ({ ...t, email: true }));
    if (!emailValid) { setError("Entrez un email valide."); return; }
    setLoading(true); setError("");
    const { data: invites } = await supabase.from('invitations').select('*').eq('email', form.email.trim());
    if (!invites || invites.length === 0) { setError("Aucune invitation trouvée pour cet email."); setLoading(false); return; }
    await sendGuestCode(form.email.trim(), null);
    setMode("guest_verify");
    setLoading(false);
  };

  const handleGuestVerify = async () => {
    setTouched(t => ({ ...t, code: true }));
    if (!codeValid) { setError("Entrez le code à 6 chiffres reçu par email."); return; }
    setLoading(true); setError("");
    const { valid } = await verifyGuestCode(form.email.trim(), form.code);
    if (!valid) { setError("Code incorrect ou expiré. Réessayez."); setLoading(false); return; }
    await supabase.from('invitations').update({ status: 'accepted' }).eq('email', form.email.trim()).eq('status', 'pending');
    onGuestAuth(form.email.trim());
    // La session est mémorisée 30 jours — plus besoin de code au prochain accès
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
                <input style={inp("name")} placeholder="Alice Martin" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  onBlur={() => touch("name")} />
                <FErr field="name" />
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Email</label>
              <input style={inp("email")} type="email" placeholder="alice@mail.com" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                onBlur={() => touch("email")} />
              <FErr field="email" />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Mot de passe {mode === "register" && <span style={{ color: "#aaa", fontWeight: 400 }}>(8 car. min.)</span>}</label>
              <input style={inp("password")} type="password" placeholder="••••••••" value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                onBlur={() => touch("password")}
                onKeyDown={e => e.key === "Enter" && handleAdmin()} />
              <FErr field="password" />
            </div>
            {error && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#C62828", marginBottom: 14 }}>⚠️ {error}</div>}
            <button onClick={handleAdmin} disabled={loading || !canSubmit}
              style={{ ...S.btnDark, width: "100%", justifyContent: "center", display: "flex", opacity: (loading || !canSubmit) ? 0.6 : 1 }}>
              {loading ? "Connexion..." : mode === "login" ? "Se connecter" : "Créer le compte"}
            </button>
            <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "#aaa" }}>
              {mode === "login" ? "Pas de compte ? " : "Déjà un compte ? "}
              <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setTouched({}); }}
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
              <input style={inp("email")} type="email" placeholder="votre@email.com" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                onBlur={() => touch("email")}
                onKeyDown={e => e.key === "Enter" && handleGuestRequest()} />
              <FErr field="email" />
            </div>
            {error && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#C62828", marginBottom: 14 }}>⚠️ {error}</div>}
            <button onClick={handleGuestRequest} disabled={loading || !emailValid}
              style={{ ...S.btnDark, width: "100%", justifyContent: "center", display: "flex", opacity: (loading || !emailValid) ? 0.6 : 1 }}>
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
              <input style={{ ...inp("code"), fontSize: 24, letterSpacing: 8, textAlign: "center", fontWeight: 700 }}
                placeholder="000000" maxLength={6} value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })}
                onBlur={() => touch("code")}
                onKeyDown={e => e.key === "Enter" && handleGuestVerify()} />
              <FErr field="code" />
            </div>
            {error && <div style={{ background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#C62828", marginBottom: 14 }}>⚠️ {error}</div>}
            <button onClick={handleGuestVerify} disabled={loading || !codeValid}
              style={{ ...S.btnDark, width: "100%", justifyContent: "center", display: "flex", opacity: (loading || !codeValid) ? 0.6 : 1 }}>
              {loading ? "Vérification..." : "Accéder →"}
            </button>
            <div style={{ textAlign: "center", fontSize: 11, color: "#aaa", marginTop: 8 }}>
              🔒 Votre session sera mémorisée 30 jours sur cet appareil
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => { setMode("guest"); setError(""); setTouched({}); }} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>← Retour</button>
              <button onClick={async () => {
                setLoading(true); setError("");
                await sendGuestCode(form.email, null);
                setLoading(false);
                addToast ? addToast("Nouveau code envoyé !", "success") : setError("Code renvoyé !");
              }} disabled={loading} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex", fontSize: 12 }}>
                🔄 Renvoyer le code
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
