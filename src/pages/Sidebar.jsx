// src/pages/Sidebar.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { useTranslation, LanguageSwitcher, LanguageMenu } from "../i18n.jsx";
import { useTheme } from "../hooks/useTheme.jsx";

export function Sidebar({ active, setActive, unreadCount, pendingCount, user, onSignOut, isMobile, menuOpen, setMenuOpen, t, lang, setLang, searchQuery, setSearchQuery, isAdmin, hasBudgetEvents }) {
  const totalBadge = unreadCount + pendingCount;

  // Super admin : nav réduite
  const adminNav = [
    { key: "superadmin", icon: "⚡", label: "Super Admin" },
  ];

  // Utilisateur normal : nav complète
  const userNav = [
    { key: "dashboard",       icon: "🏠", label: t("nav_dashboard") },
    { key: "events",          icon: "🎊", label: t("nav_events") },
    { key: "expenses",        icon: "🧾", label: t("nav_expenses") },
    { key: "contributions",   icon: "💰", label: "Contributions" },
    { key: "analytics",       icon: "📊", label: t("nav_analytics") },
    { key: "history",         icon: "📋", label: t("nav_history") },
    { key: "invite",          icon: "👥", label: t("nav_invite") },
    { key: "notifications",   icon: "🔔", label: t("nav_notifications"), badge: totalBadge },
    { key: "settings",        icon: "⚙️", label: t("nav_settings") || "Paramètres" },
  ];

  // Bottom nav mobile : 5 onglets fixes
  const mobileNav = [
    { key: "dashboard",      icon: "🏠", label: t("nav_dashboard") },
    { key: "events",         icon: "🎊", label: t("nav_events") },
    { key: "expenses",       icon: "🧾", label: t("nav_expenses") },
    { key: "contributions",  icon: "💰", label: "Contributions" },
    { key: "analytics",      icon: "📊", label: t("nav_analytics") },
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
        if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
          addToast("Notifications non supportées sur ce navigateur.", "warning");
          return;
        }
        if (pushEnabled) {
          // Désactiver — supprimer l'abonnement
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
          addToast("Notifications refusées. Autorisez-les dans les paramètres du navigateur.", "warning");
          return;
        }
        // Créer l'abonnement push
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: import.meta.env.VITE_VAPID_PUBLIC_KEY,
        });
        // Sauvegarder en base
        await fetch("/api/save-push-sub", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user?.id, subscription: sub.toJSON() }),
        });
        setPushEnabled(true);
        addToast("🔔 Notifications activées !", "success");
      } catch (e) {
        addToast("Impossible d'activer les notifications : " + e.message, "warning");
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
