// src/pages/GuestView.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { fetchEvents, fetchExpenses, fetchContributions, fetchCotisations, createExpense, createCotisation, updateCotisation, deleteCotisation, fetchAvances, createAvance, updateAvance, deleteAvance, submitPendingAction, fetchAllPendingActions } from "../supabase.js";
import { useTranslation } from "../i18n.jsx";

export function GuestView({ guestEmail, onSignOut, isMobile, addToast, t }) {
  const [events, setEvents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contributions, setContributions] = useState({});
  const [cotisations, setCotisations] = useState({});
  const [active, setActive] = useState("events");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permissionsMap, setPermissionsMap] = useState({});
  const [showRequestPerms, setShowRequestPerms] = useState(false);
  const [requestEventId, setRequestEventId] = useState("");
  const [requestedPerms, setRequestedPerms] = useState([]);
  const [requestSaving, setRequestSaving] = useState(false);
  const [filterEventId, setFilterEventId] = useState("");
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [myPendingActions, setMyPendingActions] = useState([]);
  const [showMyPending, setShowMyPending] = useState(false);

  // Ref pour les event IDs — accessible dans les callbacks Realtime sans dépendances stale
  const eventIdsRef = useRef([]);

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
    eventIdsRef.current = eventIds;

    const { data: evData } = await supabase.from('events').select('*, event_participants(name)').in('id', eventIds);
    if (!evData) { setLoading(false); return; }
    setEvents(evData);
    setFilterEventId(prev => prev && eventIds.includes(prev) ? prev : (evData[0]?.id || ""));

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

  // Rechargement silencieux (sans spinner) pour Realtime
  const silentReload = useCallback(async () => {
    const { data: invitations } = await supabase
      .from('invitations').select('event_id, role, status, permissions').eq('email', guestEmail);
    if (!invitations || invitations.length === 0) return;

    // Mettre à jour les permissions — c'est la partie critique pour le temps réel
    const pMap = {};
    invitations.forEach(i => { pMap[i.event_id] = i.permissions || []; });
    setPermissionsMap(pMap);

    const eventIds = invitations.map(i => i.event_id);
    eventIdsRef.current = eventIds;

    const { data: evData } = await supabase.from('events').select('*, event_participants(name)').in('id', eventIds);
    if (!evData) return;
    setEvents(evData);
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

    // Charger les demandes en attente de l'invité
    const { data: pendingData } = await supabase
      .from('pending_actions')
      .select('*')
      .eq('guest_email', guestEmail)
      .order('created_at', { ascending: false });
    if (pendingData) setMyPendingActions(pendingData);
  }, [guestEmail]);

  // Chargement initial
  useEffect(() => { loadGuest(); }, [loadGuest]);

  // ─── Realtime — synchronisation temps réel ────────────────────
  useEffect(() => {
    if (!guestEmail) return;

    const handleChange = (table, payload) => {
      const evId = payload.new?.event_id || payload.old?.event_id;
      // Si eventIdsRef vide (chargement initial), recharger quand même
      if (evId && eventIdsRef.current.length > 0 && !eventIdsRef.current.includes(evId)) return;
      silentReload();
      const labels = {
        expenses:      { INSERT: "📝 Nouvelle charge ajoutée", UPDATE: "✏️ Charge modifiée", DELETE: "🗑 Charge supprimée" },
        cotisations:   { INSERT: "💰 Nouvelle cotisation", UPDATE: "💰 Cotisation mise à jour", DELETE: "💰 Cotisation supprimée" },
        contributions: { INSERT: "⊜ Contribution mise à jour", UPDATE: "⊜ Contribution mise à jour", DELETE: "⊜ Contribution mise à jour" },
        event_participants: { INSERT: "👤 Participant ajouté", DELETE: "👤 Participant retiré" },
        events:        { UPDATE: "📋 Événement mis à jour" },
      };
      const msg = labels[table]?.[payload.eventType];
      if (msg) addToast(msg, "info");
    };

    const expCh = supabase
      .channel(`guest-expenses-${guestEmail}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" },
        (p) => handleChange("expenses", p))
      .subscribe();

    const cotCh = supabase
      .channel(`guest-cotisations-${guestEmail}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cotisations" },
        (p) => handleChange("cotisations", p))
      .subscribe();

    const contCh = supabase
      .channel(`guest-contributions-${guestEmail}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contributions" },
        (p) => handleChange("contributions", p))
      .subscribe();

    // Participants — visible si admin en ajoute/supprime
    const partCh = supabase
      .channel(`guest-participants-${guestEmail}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_participants" },
        (p) => handleChange("event_participants", p))
      .subscribe();

    // Événements — modification par l'admin (statut, nom, date...)
    const evCh = supabase
      .channel(`guest-events-${guestEmail}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "events" },
        (p) => handleChange("events", p))
      .subscribe();

    // S'abonner aux pending_actions — notifier l'invité si sa demande est traitée
    const pendingCh = supabase
      .channel(`guest-pending-${guestEmail}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pending_actions" },
        (payload) => {
          // Filtrer côté client sur l'email de l'invité
          if (payload.new?.guest_email !== guestEmail) return;
          if (payload.new?.status === "approved") {
            addToast(t ? t("guest_approved") : "✅ Votre demande a été approuvée par l'admin !", "success");
            silentReload();
          } else if (payload.new?.status === "rejected") {
            addToast(t ? t("guest_rejected") : "❌ Votre demande a été refusée par l'admin.", "warning");
          }
        })
      .subscribe();

    // S'abonner aux changements d'invitations (droits modifiés par l'admin)
    // Note: pas de filtre server-side car l'invité n'est pas auth Supabase → filtre côté client
    const invitCh = supabase
      .channel(`guest-invitations-${guestEmail}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "invitations" },
        (payload) => {
          // Filtrer côté client sur l'email de l'invité
          if (payload.new?.email === guestEmail) {
            silentReload();
            addToast(t ? t("guest_rights_updated") : "🔐 Vos droits ont été mis à jour.", "info");
          }
        })
      .subscribe();

    // Polling de secours toutes les 30s
    const pollInterval = setInterval(() => { silentReload(); }, 30000);

    return () => {
      supabase.removeChannel(expCh);
      supabase.removeChannel(cotCh);
      supabase.removeChannel(contCh);
      supabase.removeChannel(partCh);
      supabase.removeChannel(evCh);
      supabase.removeChannel(pendingCh);
      supabase.removeChannel(invitCh);
      clearInterval(pollInterval);
    };
  }, [guestEmail, silentReload, addToast]);

  const can = (eventId, perm) => normalizePerms(permissionsMap[eventId] || []).includes(perm);

  const submitAction = async (actionType, actionData, eventId) => {
    setSaving(true);
    const hasPerm = can(eventId, actionType === "add_expense" ? "add_expense"
      : actionType === "modify_expense" ? "edit_expense"
      : actionType === "add_cotisation" ? "add_cotisation"
      : actionType === "edit_cotisation" ? "edit_cotisation"
      : actionType === "add_participant" ? "add_participant"
      : null);

    if (hasPerm) {
      // Action directe via API serverless (bypasse les RLS pour les invités non-auth)
      try {
        const res = await fetch("/api/guest-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionType, guestEmail, eventId, data: actionData }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Erreur serveur");
        addToast(t ? t("guest_action_saved") : "✅ Action enregistrée.", "success");
      } catch (e) {
        addToast((t ? t("ev_error") : "Erreur : ") + (e.message || "action échouée"), "error");
      }
    } else {
      // Pas de droit → soumettre à l'admin pour approbation
      await submitPendingAction({ eventId, guestEmail, actionType, actionData });
      addToast(t ? t("guest_request_sent") : "📤 Demande envoyée à l'admin.", "info");
    }

    setSaving(false);
    setShowAddExpense(false);
    setEditingExpense(null);
    await silentReload();
  };

  const handleRequestPerms = async () => {
    if (!requestEventId || requestedPerms.length === 0) return;
    setRequestSaving(true);
    await requestPermissions(requestEventId, guestEmail, requestedPerms);
    setRequestSaving(false);
    setShowRequestPerms(false);
    setRequestedPerms([]);
    addToast(t ? t("guest_rights_request_sent") : "Demande de droits envoyée à l'admin.", "success");
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
    { key: "events",        icon: "◉", label: "Événements" },
    { key: "expenses",      icon: "◫", label: "Charges" },
    { key: "contributions", icon: "⊜", label: "Contributions" },
    { key: "pending",       icon: "⏳", label: "Mes demandes", badge: myPendingActions.filter(a => a.status === "pending").length },
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
            style={{ flex: 1, padding: "12px 4px", border: "none", background: "none", fontSize: 12, fontWeight: active === n.key ? 700 : 400, color: active === n.key ? "#0F0F0F" : "#888", cursor: "pointer", borderBottom: active === n.key ? "2px solid #0F0F0F" : "2px solid transparent", transition: "all 0.15s", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, position: "relative" }}>
            <span style={{ fontSize: 15 }}>{n.icon}</span>
            <span style={{ fontSize: 10 }}>{n.label}</span>
            {n.badge > 0 && <span style={{ position: "absolute", top: 6, right: "20%", background: "#C62828", color: "#fff", borderRadius: 10, fontSize: 9, fontWeight: 700, padding: "1px 5px", minWidth: 16, textAlign: "center" }}>{n.badge}</span>}
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

        {/* ── Bandeau événement bouclé ── */}
        {filterEventId && selectedEv?.status === "closed" && active !== "events" && active !== "pending" && (
          <div style={{ background: "#f0f0f0", border: "1px solid #ddd", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>🔒</span>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#555" }}>Événement bouclé</span>
              <span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>Cet événement est archivé — aucune modification possible.</span>
            </div>
          </div>
        )}

        {/* ── Bandeau droits sur l'événement sélectionné ── */}
        {filterEventId && active !== "events" && active !== "pending" && selectedEv?.status === "open" && (
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
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "#0F0F0F" }}>Événements partagés</h2>
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
                            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: ev.status === "closed" ? "#f0f0f0" : "#E8F5E9", color: ev.status === "closed" ? "#888" : "#2E7D32", fontWeight: 700 }}>
                              {ev.status === "closed" ? "🔒 Bouclé" : "✓ Ouvert"}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
                            {ev.date} · {currencySymbol(ev.currency)} · {participants.length} participants
                          </div>
                          <AvatarStack names={participants} size={22} />
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{fmt(evTotal, currencySymbol(ev.currency))}</div>
                          <div style={{ fontSize: 10, color: "#aaa" }}>{ev.event_type === "budget" ? "dépenses" : "budget"}</div>
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
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, color: "#aaa" }}>Vos droits :</span>
                        {myPerms.length === 0
                          ? <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#f5f5f5", color: "#888", fontWeight: 600 }}>👁 Lecture seule</span>
                          : myPerms.map(p => { const info = ALL_PERMISSIONS[p]; return info ? <span key={p} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: info.bg, color: info.color, fontWeight: 700 }}>{info.icon} {info.label}</span> : null; })
                        }
                        <button onClick={() => { setFilterEventId(ev.id); setActive("contributions"); }}
                          style={{ marginLeft: "auto", fontSize: 10, padding: "3px 10px", borderRadius: 8, border: "1.5px solid #eee", background: "#fafafa", color: "#555", cursor: "pointer", fontWeight: 600 }}>
                          {ev.event_type === "budget" ? "💰 Cotisations →" : "⊜ Répartition →"}
                        </button>
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
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "#0F0F0F" }}>Charges</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <EventSelector />
                {selectedEv?.status === "open" && (
                  <button onClick={() => {
                    if (can(filterEventId, "add_expense")) {
                      setShowAddExpense(!showAddExpense);
                    } else {
                      addToast(t ? t("guest_no_add_right") : "Vous n'avez pas le droit d'ajouter des charges. Votre demande sera envoyée à l'admin.", "info");
                      setShowAddExpense(!showAddExpense);
                    }
                  }} style={S.btnDark}>
                    {showAddExpense ? "× Fermer" : "➕ Ajouter"}
                  </button>
                )}
              </div>
            </div>

            {showAddExpense && (
              <GuestExpenseForm
                events={events.filter(e => e.id === filterEventId)}
                onSubmit={(actionType, data, evId) => {
                  if (can(evId, "add_expense")) {
                    submitAction(actionType, data, evId);
                  } else {
                    submitAction(actionType, { ...data, needs_approval: true }, evId);
                  }
                }}
                onCancel={() => setShowAddExpense(false)}
                saving={saving}
                isBudget={isBudget}
                canDirect={can(filterEventId, "add_expense")}
              />
            )}

            {editingExpense && (
              <GuestEditExpenseForm
                expense={editingExpense}
                events={events}
                onSubmit={async (data) => {
                  await submitAction("modify_expense", { ...data, expense_id: editingExpense.id }, editingExpense.event_id);
                }}
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
                          {selectedEv?.status === "open" && (
                            <button onClick={() => {
                              if (can(filterEventId, "edit_expense")) {
                                setEditingExpense(ex);
                              } else {
                                addToast(t ? t("guest_edit_submitted") : "Modification soumise à l'approbation de l'admin.", "info");
                                setEditingExpense(ex);
                              }
                            }} style={{ marginTop: 6, padding: "3px 10px", borderRadius: 8, border: "1.5px solid #FFE082", background: "#FFF8E1", color: "#F57F17", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
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
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "#0F0F0F" }}>
                {isBudget ? "💰 Cotisations" : "⊜ Répartition"}
              </h2>
              <EventSelector />
            </div>

            {/* Budget → vue cotisations identique admin */}
            {isBudget ? (
              <GuestCotisationsView
                ev={selectedEv}
                cotisations={evCotisations}
                sym={sym}
                participants={evParticipants}
                can={can}
                filterEventId={filterEventId}
                submitAction={submitAction}
                saving={saving}
                isMobile={isMobile}
                addToast={addToast}
                onReload={loadGuest}
                guestEmail={guestEmail}
              />
            ) : (
              /* Split → Répartition */
              <GuestBalanceSection ev={selectedEv} evExp={evExpenses} evContribMap={evContribs} sym={sym} />
            )}
          </div>
        )}

        {/* ─── ONGLET MES DEMANDES ─── */}
        {active === "pending" && (
          <div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "#0F0F0F", marginBottom: 16 }}>⏳ Mes demandes</h2>
            {myPendingActions.length === 0 ? (
              <EmptyState icon="✅" title="Aucune demande" subtitle="Vous n'avez soumis aucune demande pour l'instant." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {myPendingActions.map(action => {
                  const ev = events.find(e => e.id === action.event_id);
                  const statusConfig = {
                    pending:  { label: "⏳ En attente",  bg: "#FFF8E1", color: "#F57F17", border: "#FFE082" },
                    approved: { label: "✅ Approuvée",   bg: "#E8F5E9", color: "#2E7D32", border: "#C8E6C9" },
                    rejected: { label: "❌ Refusée",     bg: "#FFEBEE", color: "#C62828", border: "#FFCDD2" },
                  }[action.status] || { label: action.status, bg: "#f5f5f5", color: "#888", border: "#eee" };
                  const typeLabels = {
                    add_expense:        "➕ Ajout de charge",
                    modify_expense:     "✏️ Modification de charge",
                    add_cotisation:     "💰 Ajout de cotisation",
                    edit_cotisation:    "💰 Modification de cotisation",
                    add_participant:    "👤 Ajout de participant",
                    request_permissions:"🔐 Demande de droits",
                  };
                  return (
                    <div key={action.id} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: `1px solid ${statusConfig.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{typeLabels[action.action_type] || action.action_type}</div>
                          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{ev?.event_type === "budget" ? "🏦" : "💸"} {ev?.name}</div>
                        </div>
                        <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: statusConfig.bg, color: statusConfig.color, fontWeight: 700, flexShrink: 0 }}>
                          {statusConfig.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: "#aaa" }}>{new Date(action.created_at).toLocaleString("fr-FR")}</div>
                      {action.status === "pending" && (
                        <div style={{ fontSize: 11, color: "#F57F17", marginTop: 6 }}>En attente d'approbation. Vous serez notifié automatiquement.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}

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

// Vue cotisations invité — identique à l'admin, droits vérifiés à l'action
function GuestCotisationsView({ ev, cotisations, sym, participants, can, filterEventId, submitAction, saving, isMobile, addToast, onReload, guestEmail }) {
  const [showForm, setShowForm] = useState(false);
  const [formParticipant, setFormParticipant] = useState("");
  const [formMontant, setFormMontant] = useState("");
  const [formForme, setFormForme] = useState("especes");
  const [formDesc, setFormDesc] = useState("");
  const [montantMode, setMontantMode] = useState(ev?.cotisation_cible > 0 ? "minimal" : "libre");
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipant, setNewParticipant] = useState("");

  const cotisationCible = ev?.cotisation_cible || 0;
  const totalCollecte = cotisations.filter(c => c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const totalEspeces = cotisations.filter(c => c.forme === "especes" && c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const totalNature = cotisations.filter(c => c.forme === "nature").reduce((s, c) => s + c.montant, 0);
  const cible = cotisationCible > 0 ? cotisationCible * participants.length : 0;
  const pctCollecte = cible > 0 ? Math.min((totalCollecte / cible) * 100, 100) : 0;
  const participantsAvecCot = new Set(cotisations.map(c => c.participant_name));
  const participantsSansCot = participants.filter(p => !participantsAvecCot.has(p));

  const getMontant = () => montantMode === "minimal" ? cotisationCible : Number(formMontant) || 0;

  const handleAddCotisation = (participantName) => {
    const montant = getMontant();
    if (montant <= 0) { addToast(t ? t("guest_amount_required") : "Montant requis.", "warning"); return; }
    // Bloquer si participant déjà coté
    const dejaCoté = cotisations.some(c => c.participant_name === (participantName || formParticipant));
    if (dejaCoté) {
      addToast(t ? t("guest_cot_exists") : "Ce participant a déjà une cotisation.", "warning");
      return;
    }
    const data = { participant_name: participantName || formParticipant, montant, forme: formForme, statut: montant > 0 ? "paye" : "impaye", description: formDesc, event_id: filterEventId };
    submitAction("add_cotisation", data, filterEventId);
    setShowForm(false);
    setFormParticipant(""); setFormMontant(""); setFormDesc("");
  };

  const handleEditCotisation = (cot) => {
    submitAction("edit_cotisation", { cotisation_id: cot.id, montant: cot.montant, forme: cot.forme, description: cot.description }, filterEventId);
  };

  const handleDeleteCotisation = (cot) => {
    addToast(t ? t("guest_cot_delete_denied") : "La suppression de cotisations n'est pas autorisée en mode invité. Contactez l'admin.", "warning");
  };

  const handleAddParticipantAction = () => {
    if (!newParticipant.trim()) return;
    if (can(filterEventId, "add_participant")) {
      submitAction("add_participant", { name: newParticipant.trim() }, filterEventId);
    } else {
      addToast(t ? t("guest_add_participant_sent") : "Demande d'ajout de participant envoyée à l'admin.", "info");
      submitAction("add_participant", { name: newParticipant.trim(), needs_approval: true }, filterEventId);
    }
    setNewParticipant(""); setShowAddParticipant(false);
  };

  const formeBadge = (forme) => forme === "nature"
    ? { bg: "#E8F5E9", color: "#2E7D32", label: "🌿 Nature" }
    : { bg: "#E3F2FD", color: "#1565C0", label: "💵 Espèces" };
  const statutBadge = (statut) => ({
    paye:    { bg: "#E8F5E9", color: "#2E7D32",  label: "✓ Payé" },
    partiel: { bg: "#FFF8E1", color: "#F57F17",  label: "~ Partiel" },
    impaye:  { bg: "#FFEBEE", color: "#C62828",  label: "✗ Impayé" },
  })[statut] || { bg: "#f5f5f5", color: "#888", label: statut };

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <StatCard label="Total collecté" value={fmt(totalCollecte, sym)} sub={`${cotisations.filter(c => c.statut === "paye").length} cotisation(s)`} accent="#2E7D32" />
        <StatCard label="En espèces" value={fmt(totalEspeces, sym)} sub="virements + cash" accent="#1565C0" />
        <StatCard label="En nature" value={fmt(totalNature, sym)} sub="valorisation" accent="#6A1B9A" />
        <StatCard label="Cotisation cible" value={ev?.cotisation_cible > 0 ? fmt(cible, sym) : "Libre"} sub={ev?.cotisation_cible > 0 ? `${fmt(ev.cotisation_cible, sym)}/pers.` : "montant libre"} accent="#F57F17" />
      </div>

      {/* Barre progression */}
      {cible > 0 && (
        <div style={{ background: "#f5f5f5", borderRadius: 12, padding: "14px 18px", marginBottom: 16, border: "1px solid #eee" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Progression collecte</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: pctCollecte >= 100 ? "#2E7D32" : "#F57F17" }}>{fmt(totalCollecte, sym)} / {fmt(cible, sym)} ({pctCollecte.toFixed(0)}%)</span>
          </div>
          <div style={{ background: "#e0e0e0", borderRadius: 6, height: 8, overflow: "hidden" }}>
            <div style={{ background: pctCollecte >= 100 ? "#2E7D32" : "#F57F17", height: 8, width: `${pctCollecte}%`, borderRadius: 6, transition: "width 0.5s" }} />
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

      {/* Bouton ajouter participant */}
      <div style={{ marginBottom: 16 }}>
        {!showAddParticipant ? (
          <button onClick={() => setShowAddParticipant(true)} style={{ ...S.btnGhost, fontSize: 12, padding: "7px 14px" }}>
            👤 + Ajouter un participant {!can(filterEventId, "add_participant") && <span style={{ fontSize: 10, color: "#aaa", marginLeft: 4 }}>(demande approbation)</span>}
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <input style={{ ...S.input, flex: 1, minWidth: 180 }} placeholder="Prénom du participant"
              value={newParticipant} onChange={e => setNewParticipant(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAddParticipantAction()} maxLength={35} />
            <button onClick={handleAddParticipantAction} style={S.btnDark}>
              {can(filterEventId, "add_participant") ? "+ Ajouter" : "📤 Soumettre"}
            </button>
            <button onClick={() => { setShowAddParticipant(false); setNewParticipant(""); }} style={S.btnGhost}>Annuler</button>
          </div>
        )}
      </div>

      {/* Formulaire cotisation individuel */}
      {showForm && (
        <div style={{ background: "#fff", border: "1.5px solid #1565C0", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#1565C0" }}>
            ➕ Cotisation pour {formParticipant}
            {!can(filterEventId, "add_cotisation") && <span style={{ fontSize: 11, color: "#F57F17", marginLeft: 8, fontWeight: 400 }}>— sera soumise à l'admin</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <label style={S.label}>Montant ({sym}) *</label>
              {cotisationCible > 0 ? (
                <div>
                  <div style={{ display: "flex", background: "#f5f5f5", borderRadius: 9, padding: 3, gap: 2, marginBottom: 6 }}>
                    <button onClick={() => setMontantMode("minimal")} style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: "none", background: montantMode === "minimal" ? "#2E7D32" : "transparent", color: montantMode === "minimal" ? "#fff" : "#666", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      ✓ Minimal ({fmt(cotisationCible, sym)})
                    </button>
                    <button onClick={() => setMontantMode("libre")} style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: "none", background: montantMode === "libre" ? "#1565C0" : "transparent", color: montantMode === "libre" ? "#fff" : "#666", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      Autre montant
                    </button>
                  </div>
                  {montantMode === "libre" && <input type="number" min={cotisationCible} step="0.01" style={S.input} placeholder={`Min. ${fmt(cotisationCible, sym)}`} value={formMontant} onChange={e => setFormMontant(e.target.value)} />}
                  {montantMode === "minimal" && <div style={{ fontSize: 12, color: "#2E7D32", fontWeight: 700, padding: "8px 12px", background: "#E8F5E9", borderRadius: 8 }}>Montant : {fmt(cotisationCible, sym)}</div>}
                </div>
              ) : (
                <input type="number" min="0.01" step="0.01" style={S.input} placeholder="Ex: 50" value={formMontant} onChange={e => setFormMontant(e.target.value)} />
              )}
            </div>
            <div>
              <label style={S.label}>Forme</label>
              <select style={S.input} value={formForme} onChange={e => setFormForme(e.target.value)}>
                <option value="especes">💵 Espèces (cash / virement)</option>
                <option value="nature">🌿 En nature (bien ou service)</option>
              </select>
            </div>
            <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
              <label style={S.label}>Description (optionnel)</label>
              <input style={S.input} placeholder="Ex: Virement du 12/05" value={formDesc} onChange={e => setFormDesc(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handleAddCotisation(formParticipant)} disabled={saving || getMontant() <= 0}
              style={{ ...S.btnDark, opacity: getMontant() <= 0 ? 0.5 : 1 }}>
              {saving ? "..." : can(filterEventId, "add_cotisation") ? "Enregistrer" : "📤 Soumettre à l'admin"}
            </button>
            <button onClick={() => { setShowForm(false); setFormParticipant(""); }} style={S.btnGhost}>Annuler</button>
          </div>
        </div>
      )}

      {/* Liste participants + cotisations — identique admin */}
      {participants.length === 0 ? (
        <EmptyState icon="👥" title="Aucun participant" subtitle="Aucun participant dans cet événement." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {participants.map(p => {
            const cotP = cotisations.filter(c => c.participant_name === p);
            const totalP = cotP.reduce((s, c) => s + c.montant, 0);
            const hasCot = cotP.length > 0;
            const allPaid = cotP.every(c => c.statut === "paye");
            return (
              <div key={p} style={{ background: "#fff", borderRadius: 14, border: `1px solid ${!hasCot ? "#FFE082" : allPaid ? "#C8E6C9" : "#eee"}`, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                  <Avatar name={p} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</div>
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                      {hasCot ? `${cotP.length} cotisation(s) · ${fmt(totalP, sym)}` : "Aucune cotisation"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: !hasCot ? "#FFF8E1" : allPaid ? "#E8F5E9" : "#FFEBEE", color: !hasCot ? "#F57F17" : allPaid ? "#2E7D32" : "#C62828", fontWeight: 700 }}>
                      {!hasCot ? "⏳ En attente" : allPaid ? "✓ Soldé" : "~ Partiel"}
                    </span>
                    {ev?.status === "open" && (
                      <button onClick={() => {
                        setFormParticipant(p);
                        setMontantMode(cotisationCible > 0 ? "minimal" : "libre");
                        setFormMontant(""); setFormForme("especes"); setFormDesc("");
                        setShowForm(true);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, border: "1.5px solid #eee", background: "#f9f9f9", color: "#555", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                        {can(filterEventId, "add_cotisation") ? "+ Cotisation" : "📤 + Cotisation"}
                      </button>
                    )}
                  </div>
                </div>
                {cotP.length > 0 && (
                  <div style={{ borderTop: "1px solid #f0f0f0" }}>
                    {cotP.map((cot, i) => {
                      const fb = formeBadge(cot.forme);
                      const sb = statutBadge(cot.statut);
                      return (
                        <div key={cot.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: i < cotP.length - 1 ? "1px solid #f0f0f0" : "none", background: "#fafafa" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 20, background: fb.bg, color: fb.color, fontWeight: 600 }}>{fb.label}</span>
                              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 20, background: sb.bg, color: sb.color, fontWeight: 600 }}>{sb.label}</span>
                            </div>
                            {cot.description && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>💬 {cot.description}</div>}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{fmt(cot.montant, sym)}</div>
                          {ev?.status === "open" && (
                            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                              <button onClick={() => handleEditCotisation(cot)}
                                title={can(filterEventId, "edit_cotisation") ? "Modifier" : "Soumettre modification à l'admin"}
                                style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #FFE082", background: "#FFF8E1", color: "#F57F17", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                                {can(filterEventId, "edit_cotisation") ? "✏️" : "📤"}
                              </button>
                              <button onClick={() => handleDeleteCotisation(cot)}
                                title="Suppression non autorisée en mode invité"
                                style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #eee", background: "#f5f5f5", color: "#aaa", fontSize: 11, cursor: "not-allowed", fontWeight: 600 }}>
                                🗑
                              </button>
                            </div>
                          )}
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
