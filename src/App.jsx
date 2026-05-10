import { useState, useEffect, useCallback, useRef, createContext, useContext, lazy, Suspense, useMemo } from "react";
import LandingPage from "./LandingPage.jsx";
import { useTranslation, LanguageSwitcher, LanguageMenu } from "./i18n.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
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
  createReport, fetchReports,
} from "./supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS, AVATAR_STORAGE_KEY } from "./constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "./utils.js";

import { useIsMobile, useToast, ToastContainer, Avatar, EmojiPicker, AvatarStack, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "./components/ui/index.jsx";
import { S } from "./styles.js";
import { ThemeContext, ThemeProvider, useTheme } from "./hooks/useTheme.jsx";
import { saveGuestSession, loadGuestSession, clearGuestSession } from "./hooks/useGuestSession.js";
import { TEMPLATES_KEY, getTemplates, saveTemplates, ONBOARDING_KEY } from "./hooks/storage.js";
// Sidebar chargé eagerly (toujours visible quand connecté)
import { Sidebar } from "./pages/Sidebar.jsx";

// Pages chargées en lazy pour réduire le bundle initial (~830 KB → chunks séparés)
const AuthScreen       = lazy(() => import("./pages/AuthScreen.jsx").then(m => ({ default: m.AuthScreen })));
const GuestView        = lazy(() => import("./pages/GuestView.jsx").then(m => ({ default: m.GuestView })));
const Dashboard        = lazy(() => import("./pages/Dashboard.jsx").then(m => ({ default: m.Dashboard })));
const Events           = lazy(() => import("./pages/Events.jsx").then(m => ({ default: m.Events })));
const Expenses         = lazy(() => import("./pages/Expenses.jsx").then(m => ({ default: m.Expenses })));
const Balance          = lazy(() => import("./pages/Balance.jsx").then(m => ({ default: m.Balance })));
const Analytics        = lazy(() => import("./pages/Analytics.jsx").then(m => ({ default: m.Analytics })));
const History          = lazy(() => import("./pages/History.jsx").then(m => ({ default: m.History })));
const Invite           = lazy(() => import("./pages/Invite.jsx").then(m => ({ default: m.Invite })));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage.jsx").then(m => ({ default: m.NotificationsPage })));
const SettingsPage     = lazy(() => import("./pages/SettingsPage.jsx").then(m => ({ default: m.SettingsPage })));
const OnboardingWizard = lazy(() => import("./pages/OnboardingWizard.jsx").then(m => ({ default: m.OnboardingWizard })));
const SuperAdminPage   = lazy(() => import("./pages/SuperAdminPage.jsx").then(m => ({ default: m.SuperAdminPage })));
const ContributionsPage = lazy(() => import("./pages/ContributionsPage.jsx").then(m => ({ default: m.ContributionsPage })));
const CotisationsPage  = lazy(() => import("./pages/CotisationsPage.jsx").then(m => ({ default: m.CotisationsPage })));

function AppInner() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);
  const [serverError, setServerError] = useState(false);
  useEffect(() => {
    const on = () => { setIsOnline(true); };
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [guestEmail, setGuestEmail] = useState(() => {
    try { return loadGuestSession(); }
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

  const [hasNewNotif, setHasNewNotif] = useState(false);

  // Refs for stable Realtime callbacks (avoid channel teardown on events/loadAll changes)
  const eventIdsRef = useRef([]);
  const loadAllRef = useRef(null);
  const addToastRef = useRef(addToast);
  const pendingChRef = useRef(null);
  const tRef = useRef(t);

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
    contributions: t("nav_contributions") || "Contributions",
    analytics: t("nav_analytics"), history: t("nav_history"),
    invite: t("nav_invite"), notifications: t("nav_notifications"),
    settings: t("nav_settings") || "Paramètres",
    cotisations: t("nav_cotisations") || "Cotisations",
    superadmin: "Super Admin",
  };

  // Sauvegarder la session invité
  const handleGuestAuth = useCallback((email) => {
    try { saveGuestSession(email); } catch {}
    setGuestEmail(email);
    setAuthMode(null);
  }, []);

  // Déconnexion invité
  const handleGuestSignOut = useCallback(() => {
    try { clearGuestSession(); } catch {}
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
        try {
          const { data: prof } = await fetchProfile(u.id);
          setProfile(prof || null);
          if (prof?.user_role === "admin") setActive("superadmin");
        } catch {}
      }
    }).catch(() => setLoading(false));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Charger le profil à chaque changement d'utilisateur (connexion / déconnexion)
  useEffect(() => {
    if (!user) { setProfile(null); setActiveRaw("dashboard"); return; }
    fetchProfile(user.id).then(({ data: prof }) => {
      setProfile(prof || null);
      if (prof?.user_role === "admin") setActiveRaw("superadmin");
    }).catch(() => {});
  }, [user?.id]);

  const loadAll = useCallback(async () => {
    if (!user) return;
    try {
    const { data: evData } = await fetchEvents(user.id);
    if (!evData) return;
    setServerError(false);
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
    } catch { if (navigator.onLine) setServerError(true); }
  }, [user]);

  useEffect(() => { if (user) loadAll(); }, [user, loadAll]);

  // Keep refs in sync so Realtime callbacks always call the latest version
  useEffect(() => { loadAllRef.current = loadAll; }, [loadAll]);
  useEffect(() => { addToastRef.current = addToast; }, [addToast]);
  useEffect(() => { tRef.current = t; }, [t]);
  useEffect(() => { eventIdsRef.current = events.map(e => e.id); }, [events]);

  // ─── Notifications Realtime ───────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const ch = subscribeToNotifications(user.id, () => {
      fetchNotifications(user.id).then(({ data }) => { if (data) setNotifications(data); });
    });
    return () => unsubscribe(ch);
  }, [user]);

  // ─── Charges & Contributions Realtime ────────────────────────
  // Channels are stable per user session — callbacks use refs to avoid stale closures
  useEffect(() => {
    if (!user) return;

    const expCh = supabase
      .channel("expenses-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, (payload) => {
        const evId = payload.new?.event_id || payload.old?.event_id;
        if (evId && eventIdsRef.current.includes(evId)) loadAllRef.current?.();
      }).subscribe();

    const contCh = supabase
      .channel("contributions-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "contributions" }, (payload) => {
        const evId = payload.new?.event_id || payload.old?.event_id;
        if (evId && eventIdsRef.current.includes(evId)) loadAllRef.current?.();
      }).subscribe();

    const cotCh = supabase
      .channel("cotisations-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "cotisations" }, (payload) => {
        const evId = payload.new?.event_id || payload.old?.event_id;
        if (evId && eventIdsRef.current.includes(evId)) {
          loadAllRef.current?.();
          const t = tRef.current;
          addToastRef.current?.("💰 " + (t ? t("app_cotisations_updated") : "Cotisations mises à jour"), "info");
        }
      }).subscribe();

    const partCh = supabase
      .channel("participants-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "event_participants" }, (payload) => {
        const evId = payload.new?.event_id || payload.old?.event_id;
        if (evId && eventIdsRef.current.includes(evId)) loadAllRef.current?.();
      }).subscribe();

    const evCh = supabase
      .channel("events-realtime")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "events" }, (payload) => {
        if (eventIdsRef.current.includes(payload.new?.id)) loadAllRef.current?.();
      }).subscribe();

    const createPendingChannel = () => {
      const ch = supabase
        .channel("pending-actions-realtime")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "pending_actions" }, () => {
          loadAllRef.current?.();
          setHasNewNotif(true);
          const t = tRef.current;
          addToastRef.current?.("📬 " + (t ? t("app_new_guest_request") : "Nouvelle demande d'un invité"), "info");
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pending_actions" }, () => {
          loadAllRef.current?.();
        })
        .subscribe((status) => {
          console.log('[Realtime] Status:', status);
          if (status === 'CLOSED') {
            supabase.removeChannel(pendingChRef.current);
            setTimeout(createPendingChannel, 2000);
          }
        });
      pendingChRef.current = ch;
      return ch;
    };
    createPendingChannel();

    const fallbackPoll = setInterval(() => { loadAllRef.current?.(); }, 30000);

    return () => {
      supabase.removeChannel(expCh);
      supabase.removeChannel(contCh);
      supabase.removeChannel(cotCh);
      supabase.removeChannel(partCh);
      supabase.removeChannel(evCh);
      if (pendingChRef.current) supabase.removeChannel(pendingChRef.current);
      clearInterval(fallbackPoll);
    };
  }, [user?.id]);

  const handleSignOut = async () => {
    await signOut();
    setUser(null); setProfile(null); setGuestEmail(null);
    setActiveRaw("dashboard");
    setEvents([]); setExpenses([]);
    setContributions({}); setHistory([]); setNotifications([]); setPendingActions([]);
  };

  // Reset pulse notif quand la page notifications est ouverte — doit être avant tout early return
  useEffect(() => { if (active === "notifications") setHasNewNotif(false); }, [active]);

  // Normaliser contributions — useMemo ici (avant les early returns) pour respecter les Rules of Hooks
  const contribNorm = useMemo(() => {
    const result = {};
    Object.entries(contributions).forEach(([evId, arr]) => {
      result[evId] = Array.isArray(arr) ? arr : [];
    });
    return result;
  }, [contributions]);

  const sharedProps = useMemo(
    () => ({ events, expenses, contributions: contribNorm, user, reload: loadAll, isMobile, addToast, t }),
    [events, expenses, contribNorm, user, isMobile, addToast, loadAll, t]
  );

  if (loading) return <Spinner />;

  // Afficher la landing page si pas connecté et pas invité
  if (!user && !guestEmail) {
    return (
      <ErrorBoundary>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <ToastContainer toasts={toasts} removeToast={removeToast} />
        <Suspense fallback={<Spinner />}>
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
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (guestEmail) return (
    <ErrorBoundary>
      <Suspense fallback={<Spinner />}>
        <GuestView guestEmail={guestEmail} onSignOut={handleGuestSignOut} isMobile={isMobile} addToast={addToast} t={t} />
      </Suspense>
    </ErrorBoundary>
  );

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const pendingCount = pendingActions.length;

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
    <div style={{ display: "flex", height: "100vh", width: "100%", maxWidth: "100%", background: "var(--bg)", fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { overflow-x: hidden; max-width: 100%; margin:0; padding:0; }
        table { table-layout: fixed; }
        @keyframes pageFadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .page-transition { animation: pageFadeIn 0.15s ease; pointer-events: auto; }
        @keyframes notifPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.35); } }
        .notif-pulse { animation: notifPulse 0.4s ease 2; }
        .kbd-hint { display:inline-flex;align-items:center;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;padding:1px 6px;font-size:10px;font-family:monospace;color:#666; }
        [dir="rtl"] input, [dir="rtl"] textarea, [dir="rtl"] select { text-align: start; }
        [dir="rtl"] .page-transition { direction: rtl; }
      `}</style>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {!isOnline && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, background: "#F57F17", color: "#fff", textAlign: "center", padding: "8px 16px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          ⚠️ {t("error_no_internet") || t("app_offline_banner")}
          <button onClick={loadAll} style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 8, padding: "3px 12px", color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
            {t("error_retry") || "Réessayer"}
          </button>
        </div>
      )}
      {serverError && isOnline && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9998, background: "#C62828", color: "#fff", textAlign: "center", padding: "8px 16px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          🔌 {t("error_server_down") || "Le service est temporairement indisponible."}
          <button onClick={() => { setServerError(false); loadAll(); }} style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 8, padding: "3px 12px", color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
            {t("error_retry") || "Réessayer"}
          </button>
          <button onClick={() => setServerError(false)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 8, padding: "3px 10px", color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>×</button>
        </div>
      )}
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      <Sidebar active={active} setActive={setActive} unreadCount={unreadCount} pendingCount={pendingCount}
        user={user} onSignOut={handleSignOut} addToast={addToast} isMobile={isMobile} menuOpen={menuOpen} setMenuOpen={setMenuOpen}
        t={t} lang={lang} setLang={setLang} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        isAdmin={isAdmin} hasBudgetEvents={hasBudgetEvents} hasNewNotif={hasNewNotif} />

      <main role="main" style={{ flex: 1, overflow: "hidden", minWidth: 0, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
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
          <ErrorBoundary>
          <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 200 }}><Spinner /></div>}>
          {showSearch ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
                  {t("search_results_for", { query: searchQuery })}
                </h2>
                <button onClick={() => setSearchQuery("")} style={{ ...S.btnGhost, fontSize: 12 }}>{t("search_clear")}</button>
              </div>

              {/* Événements trouvés */}
              {searchResults.events.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>{t("nav_events")} ({searchResults.events.length})</div>
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
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>{t("nav_expenses")} ({searchResults.expenses.length})</div>
                  {searchResults.expenses.slice(0, 8).map(ex => {
                    const ev = events.find(e => e.id === ex.event_id);
                    const cat = CATEGORIES[ex.category];
                    const total = ex.qty * (ex.unit_price ?? 0);
                    return (
                      <div key={ex.id} onClick={() => { setActive("expenses"); setSearchQuery(""); }} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid #eee", marginBottom: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 20 }}>{cat?.icon || "🧾"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail}</div>
                          <div style={{ fontSize: 12, color: "#aaa" }}>{ev?.name} · {t("dash_paid_by")} {ex.paid_by}</div>
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
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>{t("ana_participants")} ({searchResults.participants.length})</div>
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
                <EmptyState icon="🔍" title={t("search_no_results")} subtitle={t("search_no_match", { query: searchQuery })} />
              )}
            </div>
          ) : (
            pages[active]
          )}
          </Suspense>
          </ErrorBoundary>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
