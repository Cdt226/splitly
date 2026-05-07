// src/pages/CotisationsPage.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { addParticipant, fetchCotisations, createCotisation, updateCotisation, deleteCotisation, fetchAvances, createAvance, updateAvance, deleteAvance, upsertContribution } from "../supabase.js";
import { useTranslation } from "../i18n.jsx";

export function CotisationsPage({ events, expenses, user, reload, isMobile, addToast, t, hideHeader }) {
  const budgetEvents = events.filter(e => e.event_type === "budget" && e.status === "open");
  const [filterEvent, setFilterEvent] = useState(budgetEvents[0]?.id || "");
  const ev = events.find(e => e.id === filterEvent);
  const sym = currencySymbol(ev?.currency);
  const participants = (ev?.event_participants || []).map(p => p.name);
  const cotisationCible = ev?.cotisation_cible || 0;

  const [cotisations, setCotisations] = useState([]);
  const [loadingCot, setLoadingCot] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingCot, setEditingCot] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipant, setNewParticipant] = useState("");

  // B3 — Inscription groupée
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupSelected, setGroupSelected] = useState([]);
  const [savingGroup, setSavingGroup] = useState(false);

  // B2 — Mode montant : "minimal" | "libre"
  const [montantMode, setMontantMode] = useState(cotisationCible > 0 ? "minimal" : "libre");

  // Formulaire cotisation (B1: statut supprimé)
  const emptyForm = { participant_name: "", montant: "", forme: "especes", description: "" };
  const [form, setForm] = useState(emptyForm);

  // Formulaire charge en nature
  const emptyNatureForm = { category: "Divers", sub: "", detail: "", qty: 1, unit: "", comment: "" };
  const [natureForm, setNatureForm] = useState(emptyNatureForm);

  // Recalculer montantMode quand l'événement change
  useEffect(() => {
    setMontantMode(cotisationCible > 0 ? "minimal" : "libre");
    setGroupSelected([]);
  }, [filterEvent, cotisationCible]);

  // Charger cotisations
  const loadCotisations = async () => {
    if (!filterEvent) return;
    setLoadingCot(true);
    try {
      const { data } = await fetchCotisations(filterEvent);
      setCotisations(data || []);
    } catch { setCotisations([]); }
    setLoadingCot(false);
  };

  useEffect(() => { loadCotisations(); }, [filterEvent]);

  // B1: Statut automatique selon montant
  const computeStatut = (montant) => Number(montant) > 0 ? "paye" : "impaye";

  // B2: Montant effectif selon mode
  const getMontantEffectif = () => {
    if (montantMode === "minimal" && cotisationCible > 0) return cotisationCible;
    return Number(form.montant) || 0;
  };

  const handleSave = async () => {
    if (!form.participant_name.trim()) { addToast("Sélectionnez un participant.", "warning"); return; }
    const montantEffectif = getMontantEffectif();
    if (!montantEffectif || montantEffectif <= 0) { addToast("Le montant doit être supérieur à 0.", "warning"); return; }
    if (montantMode === "libre" && cotisationCible > 0 && montantEffectif < cotisationCible) {
      addToast(`Le montant doit être au moins égal à la cotisation cible (${fmt(cotisationCible, sym)}).`, "warning"); return;
    }
    if (form.participant_name.length > 30) { addToast("Nom trop long (max 30 car.).", "warning"); return; }
    if (form.forme === "nature" && !natureForm.detail.trim()) { addToast("Précisez la nature de l'apport.", "warning"); return; }

    // Bloquer la double cotisation — modifier la cotisation existante si déjà présente
    if (!editingCot) {
      const dejaExiste = cotisations.some(c => c.participant_name === form.participant_name);
      if (dejaExiste) {
        addToast(`${form.participant_name} a déjà une cotisation. Utilisez ✏️ Modifier pour la mettre à jour.`, "warning");
        return;
      }
    }

    setSaving(true);
    const cotData = {
      event_id: filterEvent,
      participant_name: form.participant_name,
      montant: montantEffectif,
      forme: form.forme,
      statut: computeStatut(montantEffectif), // B1: automatique
      description: form.description,
    };

    try {
      if (editingCot) {
        await updateCotisation(editingCot.id, cotData);
        addToast("Cotisation mise à jour.", "success");
      } else {
        const { data: newCot } = await createCotisation(cotData);
        if (form.forme === "nature" && newCot) {
          await createExpense({
            eventId: filterEvent,
            category: natureForm.category,
            sub: natureForm.sub || form.participant_name,
            detail: natureForm.detail,
            qty: Number(natureForm.qty) || 1,
            unit: montantEffectif,
            paidBy: form.participant_name,
            included: participants,
            comment: `Apport en nature — cotisation de ${form.participant_name}`,
            is_unpaid: false,
          }, user.id);
        }
        addToast(`Cotisation de ${form.participant_name} enregistrée !`, "success");
      }
      await loadCotisations();
      await reload();
      setShowForm(false);
      setEditingCot(null);
      setForm(emptyForm);
      setNatureForm(emptyNatureForm);
      setMontantMode(cotisationCible > 0 ? "minimal" : "libre");
    } catch (e) {
      addToast("Erreur : " + e.message, "error");
    }
    setSaving(false);
  };

  // B3: Inscription groupée
  const handleSaveGroup = async () => {
    if (groupSelected.length === 0) { addToast("Sélectionnez au moins un participant.", "warning"); return; }
    if (cotisationCible <= 0) { addToast("La cotisation cible doit être définie.", "warning"); return; }
    setSavingGroup(true);
    try {
      for (const name of groupSelected) {
        await createCotisation({
          event_id: filterEvent,
          participant_name: name,
          montant: cotisationCible,
          forme: "especes",
          statut: "paye", // B1: montant > 0 → paye
          description: `Cotisation minimale groupée`,
        });
      }
      await loadCotisations();
      await reload();
      setShowGroupForm(false);
      setGroupSelected([]);
      addToast(`${groupSelected.length} cotisation(s) enregistrée(s) !`, "success");
    } catch (e) {
      addToast("Erreur : " + e.message, "error");
    }
    setSavingGroup(false);
  };

  const handleDelete = (cot) => {
    setConfirm({
      message: `Supprimer la cotisation de ${cot.participant_name} (${fmt(cot.montant, sym)}) ?`,
      onConfirm: async () => {
        await deleteCotisation(cot.id);
        await loadCotisations();
        setConfirm(null);
        addToast("Cotisation supprimée.", "info");
      },
      onCancel: () => setConfirm(null),
    });
  };

  const handleAddParticipant = async () => {
    if (!newParticipant.trim()) return;
    if (newParticipant.trim().length > 30) { addToast("Nom trop long (max 30 car.).", "warning"); return; }
    if (participants.includes(newParticipant.trim())) { addToast("Ce participant existe déjà.", "warning"); return; }
    await addParticipant(filterEvent, newParticipant.trim());
    await reload();
    setNewParticipant("");
    setShowAddParticipant(false);
    addToast(`${newParticipant.trim()} ajouté.`, "success");
  };

  // Stats
  const totalCollecte = cotisations.filter(c => c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const totalEspeces = cotisations.filter(c => c.forme === "especes" && c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const totalNature = cotisations.filter(c => c.forme === "nature").reduce((s, c) => s + c.montant, 0);
  const cible = ev?.cotisation_cible > 0 ? ev.cotisation_cible * participants.length : 0;
  const pctCollecte = cible > 0 ? Math.min((totalCollecte / cible) * 100, 100) : 0;

  // Participants sans cotisation
  const participantsAvecCot = new Set(cotisations.map(c => c.participant_name));
  const participantsSansCot = participants.filter(p => !participantsAvecCot.has(p));

  const formeBadge = (forme) => forme === "nature"
    ? { bg: "#E8F5E9", color: "#2E7D32", label: "🌿 Nature" }
    : { bg: "#E3F2FD", color: "#1565C0", label: "💵 Espèces" };

  const statutBadge = (statut) => ({
    paye:    { bg: "#E8F5E9", color: "#2E7D32",  label: "✓ Payé" },
    partiel: { bg: "#FFF8E1", color: "#F57F17",  label: "~ Partiel" },
    impaye:  { bg: "#FFEBEE", color: "#C62828",  label: "✗ Impayé" },
  })[statut] || { bg: "#f5f5f5", color: "#888", label: statut };

  if (budgetEvents.length === 0) return (
    <div>
      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>💰 Cotisations</h2>
      <p style={{ color: "var(--text-sub)", fontSize: 12, marginBottom: 20 }}>Gestion des cotisations et contributions</p>
      <EmptyState icon="🏦" title="Aucun événement Budget ouvert"
        subtitle="Créez un événement de type Budget pour gérer les cotisations." />
    </div>
  );

  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2, color: "var(--text)" }}>💰 Cotisations</h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>Gestion des cotisations et contributions</p>
        </div>
        <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => { setFilterEvent(e.target.value); setShowForm(false); setShowGroupForm(false); }}>
          {budgetEvents.map(ev => <option key={ev.id} value={ev.id}>🏦 {ev.name}</option>)}
        </select>
      </div>

      {/* Info */}
      <div style={{ background: "#E3F2FD", border: "1px solid #BBDEFB", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "#1565C0" }}>
        ℹ️ Les cotisations sont liées aux participants enregistrés. <strong>Ajoutez d'abord un participant</strong> pour créer sa cotisation.
        {cotisationCible > 0 && <span> · Cotisation cible : <strong>{fmt(cotisationCible, sym)}</strong>/participant.</span>}
      </div>

      {/* KPIs */}
      {ev && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          <StatCard label="Total collecté" value={fmt(totalCollecte, sym)} sub={`${cotisations.filter(c => c.statut === "paye").length} cotisation(s)`} accent="#2E7D32" />
          <StatCard label="En espèces" value={fmt(totalEspeces, sym)} sub="virements + cash" accent="#1565C0" />
          <StatCard label="En nature" value={fmt(totalNature, sym)} sub="valorisation" accent="#6A1B9A" />
          <StatCard label="Cotisation cible" value={ev.cotisation_cible > 0 ? fmt(cible, sym) : "Libre"} sub={ev.cotisation_cible > 0 ? `${fmt(ev.cotisation_cible, sym)}/pers.` : "montant libre"} accent="#F57F17" />
        </div>
      )}

      {/* Barre de progression collecte */}
      {cible > 0 && (
        <div style={{ background: "var(--bg-secondary)", borderRadius: 12, padding: "14px 18px", marginBottom: 16, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Progression collecte</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: pctCollecte >= 100 ? "#2E7D32" : "#F57F17" }}>{fmt(totalCollecte, sym)} / {fmt(cible, sym)} ({pctCollecte.toFixed(0)}%)</span>
          </div>
          <div style={{ background: "var(--border)", borderRadius: 6, height: 8, overflow: "hidden" }}>
            <div style={{ background: pctCollecte >= 100 ? "#2E7D32" : "#F57F17", height: 8, width: `${pctCollecte}%`, borderRadius: 6, transition: "width 0.5s" }} />
          </div>
        </div>
      )}

      {/* Boutons d'action */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => { setShowForm(!showForm); setShowGroupForm(false); setEditingCot(null); setForm(emptyForm); setMontantMode(cotisationCible > 0 ? "minimal" : "libre"); }}
          style={S.btnDark}>
          {showForm ? "× Fermer" : "+ Ajouter"}
        </button>
        {/* B3: Inscription groupée — uniquement si cible définie */}
        {cotisationCible > 0 && !showForm && (
          <button onClick={() => { setShowGroupForm(!showGroupForm); setGroupSelected([]); }}
            style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }}>
            {showGroupForm ? "× Fermer" : `👥 Inscrire en groupe (${fmt(cotisationCible, sym)})`}
          </button>
        )}
      </div>

      {/* B3 — Formulaire inscription groupée */}
      {showGroupForm && cotisationCible > 0 && (
        <div style={{ ...S.card, marginBottom: 16, border: "1.5px solid #2E7D32" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>👥 Inscription groupée</div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 14 }}>
            Enregistre le montant minimal de <strong>{fmt(cotisationCible, sym)}</strong> pour chaque participant sélectionné (espèces).
          </div>
          {/* Participants sans cotisation uniquement */}
          {(() => {
            const dejaCotisants = new Set(cotisations.map(c => c.participant_name));
            const disponibles = participants.filter(p => !dejaCotisants.has(p));
            if (disponibles.length === 0) return (
              <div style={{ fontSize: 13, color: "#2E7D32", background: "#E8F5E9", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
                ✓ Tous les participants ont déjà une cotisation enregistrée.
              </div>
            );
            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <label style={S.label}>Sélectionner les participants ({groupSelected.length}/{disponibles.length})</label>
                  <button onClick={() => setGroupSelected(groupSelected.length === disponibles.length ? [] : disponibles)}
                    style={{ fontSize: 11, color: "#1565C0", background: "none", border: "none", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                    {groupSelected.length === disponibles.length ? "Tout désélectionner" : "Tout sélectionner"}
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14, maxHeight: 200, overflowY: "auto" }}>
                  {disponibles.map(p => (
                    <label key={p} onClick={() => setGroupSelected(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 9, border: `1.5px solid ${groupSelected.includes(p) ? "#2E7D32" : "var(--border)"}`, background: groupSelected.includes(p) ? "#E8F5E9" : "var(--hover-bg)", cursor: "pointer", transition: "all 0.15s" }}>
                      <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${groupSelected.includes(p) ? "#2E7D32" : "#ccc"}`, background: groupSelected.includes(p) ? "#2E7D32" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {groupSelected.includes(p) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 13, color: "var(--text)", fontWeight: groupSelected.includes(p) ? 700 : 400 }}>{p}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "#2E7D32" }}>{fmt(cotisationCible, sym)}</span>
                    </label>
                  ))}
                </div>
              </>
            );
          })()}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSaveGroup} disabled={savingGroup || groupSelected.length === 0}
              style={{ ...S.btnDark, background: "#2E7D32", flex: 1, justifyContent: "center", display: "flex", opacity: groupSelected.length === 0 ? 0.5 : 1 }}>
              {savingGroup ? "Enregistrement..." : `✓ Enregistrer ${groupSelected.length > 0 ? `(${groupSelected.length} pers.)` : ""}`}
            </button>
            <button onClick={() => { setShowGroupForm(false); setGroupSelected([]); }} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
          </div>
        </div>
      )}

      {/* Formulaire ajout/modif individuel */}
      {showForm && (
        <div style={{ ...S.card, marginBottom: 16, border: editingCot ? "1.5px solid #F57F17" : "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>{editingCot ? "✏️ Modifier la cotisation" : "➕ Nouvelle cotisation"}</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={S.label}>Participant <span style={{ color: "#C62828" }}>*</span></label>
              {editingCot ? (
                <input style={{ ...S.input, background: "var(--hover-bg)" }} value={form.participant_name} disabled />
              ) : (
                <select style={{ ...S.input, borderColor: form.participant_name ? "#4CAF50" : "#FFB74D" }}
                  value={form.participant_name} onChange={e => setForm({ ...form, participant_name: e.target.value })}>
                  <option value="">Sélectionner...</option>
                  {participants.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              {!form.participant_name && <div style={{ fontSize: 11, color: "#F57F17", marginTop: 3 }}>⚠️ Sélectionnez un participant</div>}
            </div>

            {/* B2 — Montant intelligent */}
            <div>
              <label style={S.label}>Montant ({sym}) <span style={{ color: "#C62828" }}>*</span></label>
              {cotisationCible > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Boutons mode */}
                  <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 9, padding: 3, gap: 2 }}>
                    <button onClick={() => setMontantMode("minimal")}
                      style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: "none", background: montantMode === "minimal" ? "#2E7D32" : "transparent", color: montantMode === "minimal" ? "#fff" : "var(--text-muted)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      ✓ Minimal ({fmt(cotisationCible, sym)})
                    </button>
                    <button onClick={() => setMontantMode("libre")}
                      style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: "none", background: montantMode === "libre" ? "#1565C0" : "transparent", color: montantMode === "libre" ? "#fff" : "var(--text-muted)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      Autre montant
                    </button>
                  </div>
                  {/* Champ libre uniquement si mode libre */}
                  {montantMode === "libre" && (
                    <div>
                      <input type="number" min={cotisationCible} step="0.01" style={{ ...S.input, borderColor: (Number(form.montant) > 0 && Number(form.montant) < cotisationCible) ? "#C62828" : undefined }}
                        placeholder={`Min. ${fmt(cotisationCible, sym)}`}
                        value={form.montant}
                        onChange={e => setForm({ ...form, montant: e.target.value })} />
                      {Number(form.montant) > 0 && Number(form.montant) < cotisationCible && (
                        <div style={{ fontSize: 11, color: "#C62828", marginTop: 3 }}>⚠️ Doit être ≥ {fmt(cotisationCible, sym)}</div>
                      )}
                    </div>
                  )}
                  {montantMode === "minimal" && (
                    <div style={{ fontSize: 12, color: "#2E7D32", fontWeight: 700, padding: "8px 12px", background: "#E8F5E9", borderRadius: 8 }}>
                      Montant : {fmt(cotisationCible, sym)}
                    </div>
                  )}
                </div>
              ) : (
                <input type="number" min="0.01" step="0.01" style={S.input} placeholder="Ex: 50" value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} />
              )}
            </div>

            <div>
              <label style={S.label}>Forme</label>
              <select style={S.input} value={form.forme} onChange={e => setForm({ ...form, forme: e.target.value })}>
                <option value="especes">💵 Espèces (cash / virement)</option>
                <option value="nature">🌿 En nature (bien ou service)</option>
              </select>
            </div>

            {/* B1 — Statut automatique affiché mais non modifiable */}
            <div>
              <label style={S.label}>Statut (automatique)</label>
              <div style={{ ...S.input, background: "var(--hover-bg)", display: "flex", alignItems: "center", gap: 8, color: "var(--text-sub)", fontSize: 13 }}>
                <span style={{ fontSize: 14 }}>{getMontantEffectif() > 0 ? "✅" : "❌"}</span>
                {getMontantEffectif() > 0 ? "Payé automatiquement" : "Impayé (montant = 0)"}
              </div>
            </div>

            <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
              <label style={S.label}>Description <span style={{ color: "#aaa", fontWeight: 400 }}>(optionnel)</span></label>
              <input style={S.input} placeholder="Ex: Virement du 12/05" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>

          {/* Champs charge nature */}
          {form.forme === "nature" && !editingCot && (
            <div style={{ background: "#E8F5E9", border: "1px solid #C8E6C9", borderRadius: 10, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#2E7D32", marginBottom: 12 }}>🌿 Détail de l'apport en nature</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={S.label}>Catégorie</label>
                  <select style={S.input} value={natureForm.category} onChange={e => setNatureForm({ ...natureForm, category: e.target.value })}>
                    {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{CATEGORIES[c].icon} {c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>Désignation <span style={{ color: "#C62828" }}>*</span></label>
                  <input style={S.input} placeholder="Ex: Nettoyage de la salle" value={natureForm.detail} onChange={e => setNatureForm({ ...natureForm, detail: e.target.value })} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#2E7D32", marginTop: 8 }}>ℹ️ Une charge sera automatiquement créée dans l'onglet Charges avec le montant saisi.</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={{ ...S.btnDark, opacity: saving ? 0.6 : 1 }}>{saving ? "..." : editingCot ? "Modifier" : "Enregistrer"}</button>
            <button onClick={() => { setShowForm(false); setEditingCot(null); setForm(emptyForm); }} style={S.btnGhost}>Annuler</button>
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

      {/* Ajouter participant */}
      <div style={{ marginBottom: 16 }}>
        {!showAddParticipant ? (
          <button onClick={() => setShowAddParticipant(true)} style={{ ...S.btnGhost, fontSize: 12, padding: "7px 14px" }}>
            👤 + Ajouter un participant
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <input style={{ ...S.input, borderColor: newParticipant.length > 30 ? "#C62828" : undefined }}
                placeholder="Prénom du participant (max 30 car.)"
                value={newParticipant}
                onChange={e => setNewParticipant(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddParticipant()}
                maxLength={35} />
              {newParticipant.length > 30 && <div style={{ fontSize: 11, color: "#C62828", marginTop: 4 }}>⚠️ Max 30 caractères ({newParticipant.length}/30)</div>}
            </div>
            <button onClick={handleAddParticipant} style={S.btnDark}>+ Ajouter</button>
            <button onClick={() => { setShowAddParticipant(false); setNewParticipant(""); }} style={S.btnGhost}>Annuler</button>
          </div>
        )}
      </div>

      {/* Liste participants + cotisations */}
      {loadingCot ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-sub)" }}>Chargement...</div>
      ) : participants.length === 0 ? (
        <EmptyState icon="👥" title="Aucun participant" subtitle="Ajoutez des participants à cet événement pour commencer à gérer les cotisations." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {participants.map(p => {
            const cotP = cotisations.filter(c => c.participant_name === p);
            const totalP = cotP.reduce((s, c) => s + c.montant, 0);
            const hasCot = cotP.length > 0;
            const allPaid = cotP.every(c => c.statut === "paye");

            return (
              <div key={p} style={{ background: "var(--bg-secondary)", borderRadius: 14, border: `1px solid ${!hasCot ? "#FFE082" : allPaid ? "#C8E6C9" : "var(--border)"}`, overflow: "hidden" }}>
                {/* En-tête participant */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                  <Avatar name={p} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</div>
                    <div style={{ fontSize: 12, color: "var(--text-sub)", marginTop: 2 }}>
                      {hasCot ? `${cotP.length} cotisation(s) · ${fmt(totalP, sym)}` : "Aucune cotisation"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: !hasCot ? "#FFF8E1" : allPaid ? "#E8F5E9" : "#FFEBEE", color: !hasCot ? "#F57F17" : allPaid ? "#2E7D32" : "#C62828", fontWeight: 700 }}>
                      {!hasCot ? "⏳ En attente" : allPaid ? "✓ Soldé" : "~ Partiel"}
                    </span>
                    <button onClick={() => { setForm({ ...emptyForm, participant_name: p }); setEditingCot(null); setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--hover-bg)", color: "var(--text-muted)", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                      + Cotisation
                    </button>
                  </div>
                </div>

                {/* Détail cotisations */}
                {cotP.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)" }}>
                    {cotP.map((cot, i) => {
                      const fb = formeBadge(cot.forme);
                      const sb = statutBadge(cot.statut);
                      return (
                        <div key={cot.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: i < cotP.length - 1 ? "1px solid var(--border)" : "none", background: "var(--hover-bg)" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 20, background: fb.bg, color: fb.color, fontWeight: 600 }}>{fb.label}</span>
                              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 20, background: sb.bg, color: sb.color, fontWeight: 600 }}>{sb.label}</span>
                            </div>
                            {cot.description && <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {cot.description}</div>}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{fmt(cot.montant, sym)}</div>
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            <button onClick={() => { setEditingCot(cot); setForm({ participant_name: cot.participant_name, montant: cot.montant, forme: cot.forme, description: cot.description || "" }); setMontantMode("libre"); setShowForm(true); setShowGroupForm(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                              style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #FFE082", background: "#FFF8E1", color: "#F57F17", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>✏️</button>
                            <button onClick={() => handleDelete(cot)}
                              style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #FFCDD2", background: "#FFEBEE", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>🗑</button>
                          </div>
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
