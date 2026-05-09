// src/pages/SettingsPage.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { createReport } from "../supabase.js";
import { useTheme } from "../hooks/useTheme.jsx";
import { useTranslation, LanguageMenu } from "../i18n.jsx";

export function SettingsPage({ user, onSignOut, isMobile, addToast, events }) {
  const { t } = useTranslation();
  const { dark, toggle } = useTheme();
  const { lang, setLang } = useTranslation();
  const [pushEnabled, setPushEnabled] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );
  const [showReport, setShowReport] = useState(false);
  const [reportCategory, setReportCategory] = useState("bug");
  const [reportEventId, setReportEventId] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [sendingReport, setSendingReport] = useState(false);

  const handleSendReport = async () => {
    if (!reportMessage.trim()) { addToast("Décrivez le problème.", "warning"); return; }
    setSendingReport(true);
    const { error } = await createReport({
      userId: user.id,
      userEmail: user.email,
      category: reportCategory,
      message: reportMessage,
      eventId: reportEventId || null,
    });
    setSendingReport(false);
    if (error) { addToast("Erreur lors de l'envoi.", "error"); return; }
    setShowReport(false);
    setReportCategory("bug"); setReportEventId(""); setReportMessage("");
    addToast("✓ Signalement envoyé à l'équipe SplitLy.", "success");
  };

  const handlePushToggle = async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      addToast("Notifications non supportées sur ce navigateur.", "warning"); return;
    }
    if (pushEnabled) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/save-push-sub", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPushEnabled(false);
      addToast("🔕 Notifications désactivées.", "info");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      addToast("Notifications refusées. Autorisez-les dans les paramètres du navigateur.", "warning"); return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: import.meta.env.VITE_VAPID_PUBLIC_KEY,
      });
      await fetch("/api/save-push-sub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user?.id, subscription: sub.toJSON() }),
      });
      setPushEnabled(true);
      addToast("🔔 Notifications activées !", "success");
    } catch (e) {
      addToast("Erreur lors de l'activation : " + e.message, "warning");
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
                <select style={S.input} value={reportCategory} onChange={e => setReportCategory(e.target.value)}>
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
                  <select style={S.input} value={reportEventId} onChange={e => setReportEventId(e.target.value)}>
                    <option value="">Aucun événement spécifique</option>
                    {events.map(ev => <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={S.label}>Description du problème <span style={{ color: "#C62828" }}>*</span></label>
                <textarea style={{ ...S.input, minHeight: 100, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, borderColor: reportMessage.trim().length > 10 ? "#4CAF50" : reportMessage.length > 0 ? "#FFB74D" : undefined }}
                  placeholder="Décrivez le problème en détail : ce que vous faisiez, ce qui s'est passé, le résultat attendu..."
                  value={reportMessage}
                  onChange={e => setReportMessage(e.target.value)}
                  maxLength={1000} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3 }}>
                  {reportMessage.trim().length > 0 && reportMessage.trim().length < 10
                    ? <div style={{ fontSize: 11, color: "#F57F17" }}>⚠️ Description trop courte (min. 10 car.)</div>
                    : <div />
                  }
                  <div style={{ fontSize: 10, color: "var(--text-sub)" }}>{reportMessage.length}/1000</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleSendReport}
                  disabled={sendingReport || !reportMessage.trim() || reportMessage.trim().length < 10}
                  style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", opacity: (!reportMessage.trim() || reportMessage.trim().length < 10) ? 0.5 : 1 }}>
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
