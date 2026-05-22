// src/pages/Sidebar.jsx
import { useState } from "react";
import { Avatar } from "../components/ui/index.jsx";
import { useTranslation, LanguageMenu } from "../i18n.jsx";
import { useTheme } from "../hooks/useTheme.jsx";
import { cn } from "@/lib/utils";

export function Sidebar({ active, setActive, unreadCount, pendingCount, user, onSignOut, addToast, isMobile, menuOpen, setMenuOpen, lang, setLang, searchQuery, setSearchQuery, isAdmin, hasPersonalEvent, hasNewNotif }) {
  const { t } = useTranslation();
  const totalBadge = unreadCount + pendingCount;
  const badgeDisplay = totalBadge > 9 ? "9+" : totalBadge;

  const adminNav = [
    { key: "superadmin", icon: "⚡", label: "Super Admin" },
  ];

  const userNav = [
    { key: "dashboard",      icon: "🏠", label: t("nav_dashboard") },
    { key: "events",         icon: "🎊", label: t("nav_events") },
    { key: "expenses",       icon: "🧾", label: t("nav_expenses") },
    { key: "contributions",  icon: "💰", label: t("nav_contributions") || "Contributions" },
    { key: "analytics",      icon: "📊", label: t("nav_analytics") },
    { key: "history",        icon: "📋", label: t("nav_history") },
    { key: "invite",         icon: "👥", label: t("nav_invite") },
    { key: "notifications",  icon: "🔔", label: t("nav_notifications"), badge: badgeDisplay, pulse: hasNewNotif },
    { key: "personal",       icon: "🧍", label: t("nav_personal") || "Mes dépenses" },
    { key: "settings",       icon: "⚙️", label: t("nav_settings") || "Paramètres" },
  ];

  const mobileNav = [
    { key: "dashboard",     icon: "🏠", label: t("nav_dashboard") },
    { key: "events",        icon: "🎊", label: t("nav_events") },
    { key: "expenses",      icon: "🧾", label: t("nav_expenses") },
    { key: "contributions", icon: "💰", label: t("nav_contributions") || "Contrib." },
    { key: "analytics",     icon: "📊", label: t("nav_analytics") },
  ];

  const nav = isAdmin ? adminNav : userNav;

  const SHORTCUTS = {
    dashboard: "D", events: "E", expenses: "X",
    balance: "B", analytics: "A", history: "H",
    invite: "I", notifications: "N", personal: "P",
  };

  const NavItem = ({ n }) => {
    const isActive = active === n.key;
    return (
      <button
        onClick={() => { setActive(n.key); if (isMobile) setMenuOpen(false); }}
        title={`${n.label}${SHORTCUTS[n.key] ? ` (G+${SHORTCUTS[n.key]})` : ""}`}
        aria-label={n.label}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-0 cursor-pointer",
          "text-start w-full transition-all duration-200 text-[13px] group",
          isActive
            ? "bg-white/10 text-white font-semibold"
            : "bg-transparent text-zinc-500 hover:text-zinc-200 hover:bg-white/5 font-normal"
        )}
      >
        {isActive && (
          <div className="absolute start-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r" />
        )}
        <span className={cn("text-base flex-shrink-0 transition-opacity", isActive ? "opacity-100" : "opacity-50 group-hover:opacity-80")}>
          {n.icon}
        </span>
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">
          {n.label}
        </span>
        {!isMobile && !isActive && SHORTCUTS[n.key] && (
          <span className="text-[9px] text-zinc-700 bg-zinc-800 rounded px-1 py-px flex-shrink-0 font-mono opacity-60">
            G+{SHORTCUTS[n.key]}
          </span>
        )}
        {(n.badge && (typeof n.badge === "string" || n.badge > 0)) && (
          <span
            className={cn("bg-red-700 text-white rounded-full text-[10px] font-bold px-1.5 flex-shrink-0 min-w-[18px] text-center", n.pulse && "notif-pulse")}
          >
            {n.badge}
          </span>
        )}
      </button>
    );
  };

  const UserFooter = ({ addToast }) => {
    const { dark, toggle } = useTheme();
    const [pushEnabled, setPushEnabled] = useState(
      typeof Notification !== "undefined" && Notification.permission === "granted"
    );

    const handlePushToggle = async () => {
      try {
        if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
          addToast?.("Notifications non supportées.", "warning");
          return;
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
          addToast?.("🔕 Notifications désactivées.", "info");
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          addToast?.("Notifications refusées.", "warning");
          return;
        }
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
        addToast?.("🔔 Notifications activées !", "success");
      } catch (e) {
        addToast?.("Impossible d'activer les notifications : " + e.message, "warning");
      }
    };

    return (
      <div className="p-3.5 border-t border-zinc-800 flex-shrink-0 space-y-2">
        {/* Language */}
        <div className="relative z-50">
          <div className="text-[10px] text-zinc-600 font-semibold uppercase tracking-widest mb-1.5">🌐 Langue</div>
          <LanguageMenu lang={lang} setLang={setLang} dark={true} dropUp={true} />
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggle}
          aria-label={dark ? "Passer en mode clair" : "Passer en mode sombre"}
          aria-pressed={dark}
          className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-white/5 text-zinc-400 text-xs cursor-pointer flex items-center justify-between gap-2 hover:bg-white/8 transition-colors"
        >
          <span>{dark ? "☀️ Mode clair" : "🌙 Mode sombre"}</span>
          <div className="relative w-8 h-4.5 rounded-full transition-colors" style={{ background: dark ? "#fff" : "#333" }}>
            <div
              className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all"
              style={{ left: dark ? "16px" : "2px", background: dark ? "#333" : "#fff" }}
            />
          </div>
        </button>

        {/* Push notifications */}
        <button
          onClick={handlePushToggle}
          aria-label={pushEnabled ? "Désactiver les notifications push" : "Activer les notifications push"}
          aria-pressed={pushEnabled}
          className={cn(
            "w-full px-3 py-2 rounded-lg border border-zinc-800 text-xs cursor-pointer flex items-center gap-2 transition-colors",
            pushEnabled ? "bg-emerald-900/20 text-emerald-400" : "bg-white/5 text-zinc-400 hover:bg-white/8"
          )}
        >
          {pushEnabled ? "🔔 Notifications activées" : "🔕 Activer les notifications"}
        </button>

        {/* User profile */}
        <div className="flex items-center gap-2 py-1">
          <Avatar name={user?.user_metadata?.full_name?.[0] || user?.email?.[0] || "U"} size={30} />
          <div className="flex-1 overflow-hidden min-w-0">
            <div className="text-white text-xs font-semibold truncate">
              {user?.user_metadata?.full_name || user?.email}
            </div>
            <div className="text-amber-500 text-[10px] mt-px">✦ {isAdmin ? "Super Admin" : "Admin"}</div>
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={onSignOut}
          className="w-full py-1.5 rounded-lg border border-zinc-800 bg-transparent text-zinc-600 text-[11px] cursor-pointer hover:text-zinc-400 hover:border-zinc-700 transition-colors"
        >
          Se déconnecter
        </button>
      </div>
    );
  };

  /* ─── Mobile ─────────────────────────────────────────────── */
  if (isMobile) return (
    <>
      {/* Top bar */}
      <div className="fixed top-0 left-0 right-0 h-14 bg-zinc-950 flex items-center justify-between px-4 z-[200] shadow-lg border-b border-zinc-900">
        <button
          onClick={() => setActive("dashboard")}
          className="font-['Playfair_Display'] text-xl text-white font-bold tracking-tight"
        >
          SplitLy
        </button>
        <div className="flex items-center gap-3">
          {totalBadge > 0 && (
            <span className={cn("bg-red-700 text-white rounded-full text-[10px] font-bold px-2 py-0.5", hasNewNotif && "notif-pulse")}>
              {badgeDisplay}
            </span>
          )}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={menuOpen}
            className="bg-transparent border-0 text-white text-2xl cursor-pointer p-1"
          >
            ☰
          </button>
        </div>
      </div>

      {/* Drawer overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-[300]">
          <div onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/60" />
          <div className="absolute left-0 top-0 bottom-0 w-[270px] bg-zinc-950 flex flex-col">
            <div className="px-5 py-5 border-b border-zinc-800 flex items-center justify-between">
              <button
                onClick={() => { setActive("dashboard"); setMenuOpen(false); }}
                className="font-['Playfair_Display'] text-xl text-white font-bold"
              >
                SplitLy
              </button>
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Fermer le menu"
                className="w-8 h-8 rounded-full bg-zinc-800 border-0 text-zinc-400 cursor-pointer text-lg flex items-center justify-center hover:bg-zinc-700 transition-colors"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto px-2 py-3 space-y-0.5">
              {nav.map(n => <NavItem key={n.key} n={n} />)}
            </div>
            <UserFooter addToast={addToast} />
          </div>
        </div>
      )}

      {/* Bottom navigation */}
      <div className="fixed bottom-0 left-0 right-0 h-[62px] bg-zinc-950 flex items-center justify-around z-[200] border-t border-zinc-800">
        {(isAdmin ? adminNav : mobileNav).map(n => {
          const isActive = active === n.key;
          return (
            <button
              key={n.key}
              onClick={() => setActive(n.key)}
              aria-label={n.label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 bg-transparent border-0 cursor-pointer",
                "px-1 py-1.5 flex-1 text-center relative transition-colors",
                isActive ? "text-primary" : "text-zinc-600"
              )}
            >
              <span className="text-[19px] block">{n.icon}</span>
              <span className={cn("text-[9px] block w-full truncate", isActive ? "font-bold" : "font-normal")}>
                {n.label}
              </span>
              {n.badge > 0 && (
                <span className="absolute top-1 right-1/2 translate-x-3 bg-red-700 text-white rounded-full text-[9px] font-bold px-1 min-w-[14px] text-center">
                  {n.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );

  /* ─── Desktop Sidebar ────────────────────────────────────── */
  return (
    <aside
      role="navigation"
      aria-label="Navigation principale"
      className="w-[260px] min-w-[260px] bg-zinc-950 flex flex-col flex-shrink-0 sticky top-0 h-screen overflow-x-hidden overflow-y-auto"
    >
      {/* Logo */}
      <div className="px-5 py-5 pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActive("dashboard")}
            className="font-['Playfair_Display'] text-[22px] text-white font-bold tracking-tight bg-transparent border-0 cursor-pointer p-0"
          >
            SplitLy
          </button>
          <div title="Temps réel actif" className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981] flex-shrink-0" />
        </div>
        <div className="text-[11px] text-zinc-600 mt-0.5">Gestion de dépenses</div>
      </div>

      {/* Search */}
      <div className="px-3 py-3">
        <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/8">
          <span className="text-[13px] opacity-50">🔍</span>
          <input
            placeholder="Rechercher..."
            aria-label="Rechercher dans l'application"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-transparent border-0 outline-none text-white text-[13px] w-full placeholder:text-zinc-600"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="bg-transparent border-0 text-zinc-600 cursor-pointer text-base p-0 leading-none hover:text-zinc-400">
              ×
            </button>
          )}
        </div>
      </div>

      {/* Nav */}
      <div className="px-2.5 pt-1 flex-1 flex flex-col gap-0.5 overflow-auto">
        {nav.map(n => <NavItem key={n.key} n={n} />)}
      </div>

      {/* Footer */}
      <UserFooter addToast={addToast} />
    </aside>
  );
}
