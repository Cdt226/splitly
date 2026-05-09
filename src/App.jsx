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
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS, AVATAR_STORAGE_KEY } from "./constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "./utils.js";

import { useIsMobile, useToast, ToastContainer, Avatar, EmojiPicker, AvatarStack, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "./components/ui/index.jsx";
import { S } from "./styles.js";
import { ThemeContext, ThemeProvider, useTheme } from "./hooks/useTheme.jsx";
import { saveGuestSession, loadGuestSession, clearGuestSession } from "./hooks/useGuestSession.js";
import { TEMPLATES_KEY, getTemplates, saveTemplates, ONBOARDING_KEY } from "./hooks/storage.js";
import { AuthScreen } from "./pages/AuthScreen.jsx";
import { GuestView } from "./pages/GuestView.jsx";
import { Sidebar } from "./pages/Sidebar.jsx";
import { Dashboard } from "./pages/Dashboard.jsx";
import { Events } from "./pages/Events.jsx";
import { Expenses } from "./pages/Expenses.jsx";
import { Balance } from "./pages/Balance.jsx";
import { Analytics } from "./pages/Analytics.jsx";
import { History } from "./pages/History.jsx";
import { Invite } from "./pages/Invite.jsx";
import { NotificationsPage } from "./pages/NotificationsPage.jsx";
import { SettingsPage } from "./pages/SettingsPage.jsx";
import { OnboardingWizard } from "./pages/OnboardingWizard.jsx";
import { SuperAdminPage } from "./pages/SuperAdminPage.jsx";
import { ContributionsPage } from "./pages/ContributionsPage.jsx";
import { CotisationsPage } from "./pages/CotisationsPage.jsx";

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

    const expCh = supabase
      .channel("expenses-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, (payload) => {
        const evId = payload.new?.event_id || payload.old?.event_id;
        if (evId && eventIds.includes(evId)) loadAll();
      }).subscribe();

    const contCh = supabase
      .channel("contributions-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "contributions" }, (payload) => {
        const evId = payload.new?.event_id || payload.old?.event_id;
        if (evId && eventIds.includes(evId)) loadAll();
      }).subscribe();

    const cotCh = supabase
      .channel("cotisations-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "cotisations" }, (payload) => {
        const evId = payload.new?.event_id || payload.old?.event_id;
        if (evId && eventIds.includes(evId)) {
          loadAll();
          addToast(t ? "💰 " + t("app_cotisations_updated") : "💰 Cotisations mises à jour", "info");
        }
      }).subscribe();

    // Participants — ajout/suppression par un invité autorisé
    const partCh = supabase
      .channel("participants-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "event_participants" }, (payload) => {
        const evId = payload.new?.event_id || payload.old?.event_id;
        if (evId && eventIds.includes(evId)) loadAll();
      }).subscribe();

    // Événements — modification par un invité
    const evCh = supabase
      .channel("events-realtime")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "events" }, (payload) => {
        if (eventIds.includes(payload.new?.id)) loadAll();
      }).subscribe();

    // Demandes en attente — INSERT et UPDATE (approbation/refus)
    const pendingCh = supabase
      .channel("pending-actions-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pending_actions" }, () => {
        loadAll();
        addToast(t ? "📬 " + t("app_new_guest_request") : "📬 Nouvelle demande d'un invité", "info");
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pending_actions" }, () => {
        loadAll();
      }).subscribe();

    return () => {
      supabase.removeChannel(expCh);
      supabase.removeChannel(contCh);
      supabase.removeChannel(cotCh);
      supabase.removeChannel(partCh);
      supabase.removeChannel(evCh);
      supabase.removeChannel(pendingCh);
    };
  }, [user?.id, events.length]);

  const handleSignOut = async () => {
    await signOut();
    setUser(null); setProfile(null); setGuestEmail(null);
    setActiveRaw("dashboard");
    setEvents([]); setExpenses([]);
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
    <div style={{ display: "flex", height: "100vh", width: "100%", maxWidth: "100%", background: "var(--bg)", fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { overflow-x: hidden; max-width: 100%; margin:0; padding:0; }
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
