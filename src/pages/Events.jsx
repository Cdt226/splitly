// src/pages/Events.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { createEvent, updateEvent, deleteEvent, updateEventStatus, addParticipant, removeParticipant, fetchCotisations, exportPDF, archiveEvent, restoreEvent, fetchArchivedEvents } from "../supabase.js";
import { getTemplates, saveTemplates } from "../hooks/storage.js";
import { useTranslation } from "../i18n.jsx";
import { Analytics } from "./Analytics.jsx";
import { Expenses } from "./Expenses.jsx";
import { Balance } from "./Balance.jsx";
import { CotisationsPage } from "./CotisationsPage.jsx";

export function exportBudgetPDF(ev, expenses, cotisations) {
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
export function EventDetail({ ev, events, expenses, contributions, user, reload, isMobile, addToast, t, onBack }) {
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
        <StatCard label={t ? t("ev_stat_budget") : "Budget"} value={fmt(totalDepenses, sym)} sub={`${evExp.length} charge(s)`} accent="#0F0F0F" />
        <StatCard label={t ? t("ev_stat_participants") : "Participants"} value={participants.length} sub={t ? t("ev_sub_registered") : "inscrits"} accent="#1565C0" />
        {isBudget && <StatCard label={t ? t("ev_stat_collected") : "Collecté"} value={fmt(cotisations.filter(c => c.statut === "paye").reduce((s, c) => s + c.montant, 0), sym)} sub={t ? t("ev_sub_cotisations") : "cotisations"} accent="#2E7D32" />}
        {isBudget && ev.nombre_invites > 0 && <StatCard label={t ? t("ev_stat_guests") : "Invités"} value={ev.nombre_invites} sub={t ? t("ev_sub_expected") : "attendus"} accent="#F57F17" />}
        {!isBudget && <StatCard label={t ? t("ev_stat_currency") : "Devise"} value={sym} sub={ev.currency} accent="#6A1B9A" />}
        {!isBudget && <StatCard label={t ? t("ev_stat_status") : "Statut"} value={t ? (ev.status === "closed" ? t("ev_closed") : t("ev_open")) : (ev.status === "closed" ? "Bouclé" : "Ouvert")} sub={ev.date} accent={ev.status === "closed" ? "#999" : "#2E7D32"} />}
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
export function Events({ events, expenses, contributions, user, reload, isMobile, addToast}) {
  const { t } = useTranslation();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", date: "", currency: "EUR €", participants: [], event_type: "split", cotisation_cible: "", nombre_invites: "", allow_multiple_contributions: false });
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
  const [archivedEvents, setArchivedEvents] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);

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
      allow_multiple_contributions: ev.allow_multiple_contributions || false,
    });
  };

  // Sauvegarder les modifications d'un événement
  const handleSaveEdit = async () => {
    if (!editForm.name?.trim()) { addToast(t ? t("toast_name_required") : "Le nom est obligatoire.", "warning"); return; }
    if (editForm.name.trim().length > 30) { addToast(t ? t("ev_name_too_long") : "Nom trop long (max 30 car.).", "warning"); return; }
    if (!editForm.date) { addToast(t ? t("ev_date_required") : "La date est obligatoire.", "warning"); return; }
    const editInputDate = new Date(editForm.date);
    const editTomorrow = new Date(); editTomorrow.setDate(editTomorrow.getDate() + 1); editTomorrow.setHours(23, 59, 59, 999);
    if (editInputDate > editTomorrow) { addToast(t ? t("validation_future_date") : "La date ne peut pas être dans le futur de plus d'1 jour.", "warning"); return; }

    // Bloquer le changement de type si des données existent
    if (editForm.event_type !== editingEv.event_type) {
      const hasExpenses = expenses.some(e => e.event_id === editingEv.id);
      if (hasExpenses) {
        addToast(t ? t("ev_type_change_error") : "Impossible de changer le type : cet événement contient des charges.", "warning");
        return;
      }
    }

    setEditLoading(true);
    const fields = {
      name: editForm.name.trim(),
      date: editForm.date,
      currency: editForm.currency,
      event_type: editForm.event_type,
      cotisation_cible: editForm.event_type === "budget" ? (parseFloat(editForm.cotisation_cible) || 0) : 0,
      nombre_invites: editForm.event_type === "budget" ? (parseInt(editForm.nombre_invites) || 0) : 0,
      allow_multiple_contributions: editForm.event_type === "budget" ? (editForm.allow_multiple_contributions ?? false) : false,
    };
    const { error } = await updateEvent(editingEv.id, fields, user.id);
    if (error) { addToast((t ? t("ev_error") : "Erreur : ") + error.message, "error"); }
    else {
      await reload();
      setEditingEv(null);
      addToast(t ? t("ev_updated") : "Événement modifié.", "success");
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
      event_type: ev.event_type || "split",
      cotisation_cible: ev.cotisation_cible || 0,
      nombre_invites: ev.nombre_invites || 0,
      participants,
      savedAt: new Date().toISOString(),
    };
    const updated = [template, ...templates.filter(t => t.name !== ev.name)].slice(0, 10);
    saveTemplates(updated);
    setTemplates(updated);
    addToast(`${t ? t("ev_template_saved") : "Modèle sauvegardé"} "${ev.name}" !`, "success");
  };

  // Créer un événement depuis un modèle
  const handleUseTemplate = (template) => {
    setForm({
      name: template.name,
      date: new Date().toISOString().split("T")[0],
      currency: template.currency,
      event_type: template.event_type || "split",
      cotisation_cible: template.cotisation_cible || "",
      nombre_invites: template.nombre_invites || "",
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
    if (!form.name.trim()) { addToast(t ? t("toast_name_required") : "Le nom de l'événement est obligatoire.", "warning"); return; }
    if (form.name.trim().length > MAX_NAME_LENGTH) { addToast(t ? t("ev_name_too_long") : `Le nom ne peut pas dépasser ${MAX_NAME_LENGTH} caractères.`, "warning"); return; }
    if (!form.date) { addToast(t ? t("ev_date_required") : "La date est obligatoire.", "warning"); return; }
    if (form.participants.length < 1) { addToast(t ? t("ev_min_participant") : "Minimum 1 participant requis.", "warning"); return; }
    const inputDate = new Date(form.date);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(23, 59, 59, 999);
    if (inputDate > tomorrow) { addToast(t ? t("validation_future_date") : "La date ne peut pas être dans le futur de plus d'1 jour.", "warning"); return; }
    const maxP = form.event_type === "budget" ? MAX_PARTICIPANTS_BUDGET : MAX_PARTICIPANTS;
    if (form.participants.length > maxP) { addToast(`${t ? t("ev_max_participants_type") : "Maximum"} ${maxP} ${t ? t("ev_participants_for") : "participants pour un événement"} ${form.event_type === "budget" ? "Budget" : "Split"}.`, "warning"); return; }
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
      setForm({ name: "", date: "", currency: "EUR €", participants: [], event_type: "split", cotisation_cible: "", nombre_invites: "", allow_multiple_contributions: false });
      setShowNew(false);
      addToast(`${t ? t("toast_event_created") : "Événement créé avec succès !"}`, "success");
    } else {
      addToast((t ? t("ev_create_error") : "Erreur lors de la création : ") + error.message, "error");
    }
    setLoading(false);
  };

  const handleArchive = (ev) => {
    const evExpenses = expenses.filter(e => e.event_id === ev.id);
    const evTotal = evExpenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
    const participantsList = (ev.event_participants || []).map(p => p.name);
    setConfirm({
      message: `Archiver "${ev.name}" ?`,
      warnings: [
        `${evExpenses.length} charge(s) · ${fmt(evTotal, currencySymbol(ev.currency))} · ${participantsList.length} participant(s)`,
        "Cet événement sera archivé et ne sera plus visible. Les données sont conservées.",
      ],
      onConfirm: async () => {
        await archiveEvent(ev.id, user.id);
        await reload();
        setConfirm(null);
        addToast(`"${ev.name}" ${t ? t("ev_archive_success") : "archivé."}`, "info");
      },
      onCancel: () => setConfirm(null),
    });
  };

  const loadArchivedEvents = useCallback(async () => {
    setLoadingArchived(true);
    const { data } = await fetchArchivedEvents(user.id);
    setArchivedEvents(data || []);
    setLoadingArchived(false);
  }, [user?.id]);

  const handleRestore = async (ev) => {
    await restoreEvent(ev.id);
    await Promise.all([reload(), loadArchivedEvents()]);
    addToast(`"${ev.name}" ${t ? t("ev_restore") : "restauré."}`, "success");
  };

  const handleToggleArchived = () => {
    const next = !showArchived;
    setShowArchived(next);
    if (next) loadArchivedEvents();
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
        addToast(`${t ? t("ev_lock_cotisation_error") : "Bouclage impossible"} — ${nonCotisants.length} participant(s) : ${nonCotisants.join(", ")}`, "warning");
        return;
      }
    } else {
      // Option Split : tous les participants doivent être soldés
      const allSettled = participants.every(p => isSettled(computeNetBalance(evExp, evContribMap, p)));
      if (!allSettled) { addToast(t ? t("toast_settle_first") : "Tous les participants doivent solder avant de boucler.", "warning"); return; }
    }
    setConfirm({
      message: `Boucler "${ev.name}" ? L'historique sera effacé et aucune modification ne sera plus possible.`,
      warnings: ["Action irréversible.", "Un résumé PDF sera envoyé par email à l'admin."],
      onConfirm: async () => {
        await updateEventStatus(ev.id, "closed");
        await reload();
        setConfirm(null);
        addToast(`"${ev.name}" ${t ? t("ev_locked_msg") : "bouclé avec succès."}`, "success");

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
          addToast(t ? t("ev_email_sent") : "Résumé envoyé par email !", "info");
        } catch (e) {
          console.error("Erreur envoi résumé clôture:", e);
        }
      },
      onCancel: () => setConfirm(null),
    });
  };

  const handleAddParticipant = async (ev) => {
    const name = newParticipant.trim();
    if (!name) { addToast(t ? t("toast_participant_empty") : "Le prénom ne peut pas être vide.", "warning"); return; }
    if (name.length < 2) { addToast(t ? t("validation_required") : "Minimum 2 caractères requis.", "warning"); return; }
    if (name.length > MAX_PARTICIPANT_NAME) { addToast(t ? t("toast_participant_too_long") : `Le prénom ne peut pas dépasser ${MAX_PARTICIPANT_NAME} caractères.`, "warning"); return; }
    const currentCount = (ev.event_participants || []).length;
    if (currentCount >= (ev?.event_type === "budget" ? MAX_PARTICIPANTS_BUDGET : MAX_PARTICIPANTS)) {
      addToast(t ? t("toast_max_participants") : `Maximum participants atteint.`, "warning"); return;
    }
    const existing = (ev.event_participants || []).map(p => p.name.toLowerCase());
    if (existing.includes(name.toLowerCase())) { addToast(t ? t("toast_duplicate_participant") : "Ce participant existe déjà.", "warning"); return; }
    await addParticipant(ev.id, name);
    await reload();
    setNewParticipant("");
    addToast(`${name} ${t ? t("ev_participant_added") : "ajouté à l'événement."}`, "success");
    setManagingEv(events.find(e => e.id === ev.id) || ev);
  };

  const [selectedEvent, setSelectedEvent] = useState(null); // null = liste, ev = détail

  const handleRemoveParticipant = (ev, name) => {
    const evExpenses = expenses.filter(e => e.event_id === ev.id);

    // Bloquer si solde non réglé (Split uniquement — les budgets n'ont pas de répartition)
    if (ev.event_type !== "budget") {
      const evContribMap = {};
      (contributions[ev.id] || []).forEach(c => { evContribMap[c.participant] = c.amount; });
      const netBalance = computeNetBalance(evExpenses, evContribMap, name);
      if (Math.abs(netBalance) > 1) {
        setConfirm({
          message: `Impossible de supprimer "${name}"`,
          warnings: [`Ce participant a un solde non réglé de ${fmt(Math.abs(netBalance), currencySymbol(ev.currency))}. Soldez d'abord ce participant.`],
          onConfirm: null,
          onCancel: () => setConfirm(null),
          confirmOnly: true,
        });
        return;
      }
    }

    const isPaidBy = evExpenses.some(e => e.paid_by === name && !e.is_unpaid);
    if (isPaidBy) {
      const count = evExpenses.filter(e => e.paid_by === name && !e.is_unpaid).length;
      setConfirm({
        message: `Impossible de retirer "${name}"`,
        warnings: [
          `${name} est responsable de ${count} charge(s) dans "${ev.name}".`,
          `Modifiez d'abord ces charges (changez le payeur) avant de retirer ce participant.`
        ],
        onConfirm: null,
        onCancel: () => setConfirm(null),
        confirmOnly: true,
      });
      return;
    }
    setConfirm({
      message: `Retirer "${name}" de "${ev.name}" ?`,
      warnings: evExpenses.some(e => (e.included || []).includes(name))
        ? [`${name} est inclus dans des charges — sa part sera redistribuée entre les autres participants.`]
        : [],
      onConfirm: async () => {
        await removeParticipant(ev.id, name);
        await reload();
        setConfirm(null);
        addToast(`${name} ${t ? t("ev_participant_removed") : "retiré de l'événement."}`, "info");
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
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, cursor: "pointer", fontSize: 12, color: "#E65100", fontWeight: 600 }}>
                  <input type="checkbox" checked={editForm.allow_multiple_contributions || false} onChange={e => setEditForm({ ...editForm, allow_multiple_contributions: e.target.checked })} />
                  Autoriser les cotisations multiples par participant
                </label>
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>Événements</h2>
          <p style={{ color: "#888", fontSize: 12 }}>{events.length} événement{events.length > 1 ? "s" : ""}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
          {templates.length > 0 && (
            <button onClick={() => setShowTemplates(!showTemplates)}
              style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px", whiteSpace: "nowrap" }}>
              📋 Modèles ({templates.length})
            </button>
          )}
          <button onClick={handleToggleArchived}
            style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px", whiteSpace: "nowrap" }}>
            📦 {t ? t("ev_archived_events") : "Archivés"}{archivedEvents.length > 0 && showArchived ? ` (${archivedEvents.length})` : ""}
          </button>
          <button onClick={() => { setShowNew(!showNew); setShowTemplates(false); }} style={{ ...S.btnDark, whiteSpace: "nowrap" }}>
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
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: t.event_type === "budget" ? "#FFF8E1" : "#F3E5F5", color: t.event_type === "budget" ? "#F57F17" : "#6A1B9A", fontWeight: 700 }}>
                      {t.event_type === "budget" ? "🏦 Budget" : "💸 Split"}
                    </span>
                    {t.participants.length} participants · {currencySymbol(t.currency)} · {new Date(t.savedAt).toLocaleDateString("fr-FR")}
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
              <label style={S.label}>Nom de l'événement <span style={{ color: "#C62828" }}>*</span> <span style={{ color: form.name.length > 30 ? "#C62828" : "#aaa", fontWeight: form.name.length > 30 ? 700 : 400 }}>{form.name.length}/30</span></label>
              <input style={{ ...S.input, borderColor: form.name.length > 30 ? "#C62828" : form.name.trim().length > 0 && form.name.trim().length <= 30 ? "#4CAF50" : undefined, transition: "border-color 0.2s" }}
                placeholder="Ex: Fête de fin d'année" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={50} />
              {form.name.length > 30 && <div style={{ fontSize: 11, color: "#C62828", marginTop: 4 }}>⚠️ Max 30 caractères ({form.name.length}/30)</div>}
            </div>
            <div>
              <label style={S.label}>Date <span style={{ color: "#C62828" }}>*</span></label>
              <input type="date" style={{ ...S.input, borderColor: form.date ? "#4CAF50" : undefined, transition: "border-color 0.2s" }}
                value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
              {!form.date && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Sélectionnez une date</div>}
            </div>
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
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, cursor: "pointer", fontSize: 12, color: "#E65100", fontWeight: 600 }}>
                <input type="checkbox" checked={form.allow_multiple_contributions} onChange={e => setForm({ ...form, allow_multiple_contributions: e.target.checked })} />
                Autoriser les cotisations multiples par participant
              </label>
            </div>
          )}

          {/* ── Participants ── */}
          <div style={{ marginBottom: 18 }}>
            <ParticipantInput participants={form.participants} onChange={p => setForm({ ...form, participants: p })} />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleCreate}
              disabled={loading || form.participants.length < 1 || form.name.trim().length === 0 || form.name.trim().length > 30 || !form.date}
              style={{ ...S.btnDark, opacity: (loading || form.participants.length < 1 || form.name.trim().length === 0 || form.name.trim().length > 30 || !form.date) ? 0.5 : 1 }}>
              {loading ? "Création..." : `Créer l'événement ${form.event_type === "budget" ? "🏦" : "💸"}`}
            </button>
            <button onClick={() => setShowNew(false)} style={S.btnGhost}>Annuler</button>
          </div>
          {/* Récapitulatif erreurs si tentative submit avec champs vides */}
          {(form.name.trim().length === 0 || !form.date || form.participants.length < 1) && (
            <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
              {!form.name.trim() && <span style={{ fontSize: 11, color: "#C62828" }}>· Nom requis</span>}
              {!form.date && <span style={{ fontSize: 11, color: "#C62828" }}>· Date requise</span>}
              {form.participants.length < 1 && <span style={{ fontSize: 11, color: "#C62828" }}>· Min. 1 participant</span>}
            </div>
          )}
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
                <option value="name_asc">{t ? t("ev_sort_name") : "🔤 Nom A→Z"}</option>
                <option value="amount_desc">{t ? t("ev_sort_budget") : "💰 Budget ↓"}</option>
                <option value="status">{t ? t("ev_sort_status") : "🔒 Statut"}</option>
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
                      <div style={{ display: "flex", flexDirection: "row", gap: 4, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }} onClick={e => e.stopPropagation()}>
                        <button onClick={e => { e.stopPropagation(); handleSaveTemplate(ev); }} title="Modèle"
                          style={{ minWidth: 32, minHeight: 32, padding: "6px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--hover-bg)", color: "var(--text-muted)", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          📋
                        </button>
                        <button onClick={e => { e.stopPropagation(); openEditEvent(ev); }} title="Modifier"
                          style={{ minWidth: 32, minHeight: 32, padding: "6px 10px", borderRadius: 8, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          ✏️
                        </button>
                        {allSettled && (
                          <button onClick={e => { e.stopPropagation(); handleClose(ev); }} style={{ minWidth: 32, minHeight: 32, padding: "6px 10px", borderRadius: 8, border: "none", background: "#2E7D32", color: "#fff", fontSize: 14, cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            🔒
                          </button>
                        )}
                        <button onClick={e => { e.stopPropagation(); handleArchive(ev); }} title={t ? t("ev_archive_confirm") : "Archiver"} style={{ minWidth: 32, minHeight: 32, padding: "6px 10px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
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

      {/* ── ÉVÉNEMENTS ARCHIVÉS ── */}
      {showArchived && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            📦 {t ? t("ev_archived_events") : "Événements archivés"}
            {loadingArchived && <span style={{ fontSize: 11, color: "var(--text-sub)", fontWeight: 400 }}>Chargement...</span>}
          </div>
          {!loadingArchived && archivedEvents.length === 0 && (
            <EmptyState icon="📦" title="Aucun événement archivé" subtitle="Les événements archivés apparaîtront ici." />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {archivedEvents.map(ev => {
              const evExp = expenses.filter(e => e.event_id === ev.id);
              const evTotal = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
              const participantsList = (ev.event_participants || []).map(p => p.name);
              return (
                <div key={ev.id} style={{ background: "var(--bg-secondary)", borderRadius: 14, padding: "14px 18px", border: "1px solid var(--border)", opacity: 0.8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
                        <span>📦</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</span>
                        <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: "var(--hover-bg)", color: "var(--text-sub)", fontWeight: 700, flexShrink: 0 }}>Archivé</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-sub)" }}>
                        {ev.date} · {participantsList.length} participant(s) · {evExp.length} charge(s) · {fmt(evTotal, currencySymbol(ev.currency))}
                        {ev.archived_at && ` · ${new Date(ev.archived_at).toLocaleDateString('fr-FR')}`}
                      </div>
                    </div>
                    <button onClick={() => handleRestore(ev)}
                      style={{ padding: "6px 16px", borderRadius: 9, border: "1.5px solid #c8e6c9", background: "#E8F5E9", color: "#2E7D32", fontSize: 12, cursor: "pointer", fontWeight: 700, flexShrink: 0, fontFamily: "inherit" }}>
                      ↩ {t ? t("ev_restore") : "Restaurer"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
      )}
    </div>
  );
}
