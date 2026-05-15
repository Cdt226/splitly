// src/pages/Expenses.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { OCRCapture } from "../components/OCRCapture.jsx";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { createExpense, updateExpense, deleteExpense, upsertContribution, fetchAuditLogs } from "../supabase.js";
import { useTranslation } from "../i18n.jsx";

export function exportChargesPDF(ev, evExpenses) {
  const sym = currencySymbol(ev.currency);
  const fmt2 = n => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
  const total = evExpenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const participants = (ev.event_participants || []).map(p => p.name);
  const byCategory = Object.keys(CATEGORIES).map(cat => ({
    cat, total: evExpenses.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0)
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  const rows = evExpenses.map((ex, i) => {
    const exTotal = ex.qty * (ex.unit_price ?? 0);
    return `<tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'}">
      <td style="padding:9px 12px">${CATEGORIES[ex.category]?.icon || ''} ${ex.category}</td>
      <td style="padding:9px 12px;font-weight:600">${ex.detail}</td>
      <td style="padding:9px 12px">${ex.paid_by || '—'}</td>
      <td style="padding:9px 12px;text-align:center">${ex.qty > 1 ? `${ex.qty} × ${fmt2(ex.unit_price ?? 0)}` : '—'}</td>
      <td style="padding:9px 12px;text-align:right;font-weight:700">${fmt2(exTotal)}</td>
    </tr>`;
  }).join('');

  const catBars = byCategory.map(c => `
    <div class="cat-bar">
      <div class="cat-bar-label">
        <span>${CATEGORIES[c.cat]?.icon || '🏷️'} ${c.cat}</span>
        <strong style="color:${CATEGORIES[c.cat]?.accent || '#333'}">${fmt2(c.total)} (${total > 0 ? ((c.total / total) * 100).toFixed(0) : 0}%)</strong>
      </div>
      <div class="cat-bar-track"><div style="background:${CATEGORIES[c.cat]?.accent || '#aaa'};height:6px;width:${total > 0 ? (c.total / total) * 100 : 0}%;border-radius:3px"></div></div>
    </div>`).join('');

  buildPDF({
    title: ev.name,
    subtitle: `Bilan des charges${ev.event_type === "budget" ? " — Événement Budget" : ""}`,
    docType: ev.event_type === "budget" ? "Rapport Charges · Événement Budget" : "Rapport Charges · Événement Split",
    meta: [
      { label: "Date de l'événement", value: ev.date },
      { label: "Participants", value: `${participants.length} personne${participants.length > 1 ? 's' : ''}` },
      { label: "Devise", value: sym },
      ...(ev.nombre_invites > 0 ? [{ label: "Invités attendus", value: ev.nombre_invites }] : []),
    ],
    summaryItems: [
      { label: "Total dépenses", value: fmt2(total), sub: `${evExpenses.length} charge(s)`, accent: "#C62828", color: "#C62828" },
      { label: "Catégories", value: byCategory.length, sub: "catégories actives", accent: "#1565C0" },
      { label: "Moy. / charge", value: fmt2(evExpenses.length > 0 ? total / evExpenses.length : 0), sub: "par dépense", accent: "#F57F17" },
      ...(ev.nombre_invites > 0 ? [{ label: "Coût / invité", value: fmt2(total / ev.nombre_invites), sub: `sur ${ev.nombre_invites} invités`, accent: "#6A1B9A" }] : []),
    ],
    sections: [
      { title: "Répartition par catégorie", content: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${catBars}</div>` },
      {
        title: `Détail des charges (${evExpenses.length})`,
        content: `<table>
          <thead><tr><th>Catégorie</th><th>Désignation</th><th>Responsable</th><th style="text-align:center">Détail</th><th style="text-align:right">Montant</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="4">TOTAL DÉPENSES</td><td style="text-align:right;color:#C62828">${fmt2(total)}</td></tr></tfoot>
        </table>`
      },
    ],
  });
}

// ─── CHARGES ──────────────────────────────────────────────────
export function Expenses({ events, expenses, contributions, user, reload, isMobile, addToast, hideHeader, defaultEventId }) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [filterEvent, setFilterEvent] = useState(defaultEventId || "all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [sortBy, setSortBy] = useState("date_desc");
  const [searchText, setSearchText] = useState("");
  const [editingEx, setEditingEx] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [unpaid, setUnpaid] = useState(false);
  const [showOCR, setShowOCR] = useState(false);
  const [showChoice, setShowChoice] = useState(false);
  const [auditModal, setAuditModal] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanFeedback, setScanFeedback] = useState(null);
  const scanRef = useRef(null);

  const closeAll = () => { setShowForm(false); setShowOCR(false); setShowChoice(false); setScanFeedback(null); setScanLoading(false); };
  const empty = { eventId: defaultEventId || "", category: "", sub: "", detail: "", qty: 1, unit: "", paidBy: "", included: [], comment: "" };
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
  const sym = currencySymbol(currentEvent?.currency);

  const handleScanFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setScanFeedback({ type: 'error', message: 'Fichier trop volumineux (max 10 Mo).' });
      return;
    }

    setScanFeedback(null);
    setScanLoading(true);

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Non authentifié — reconnectez-vous');

      const res = await fetch('/api/scan-receipt', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ image: base64, contentType: file.type, action: 'quick' }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

      if (data.is_expense === false) {
        setScanFeedback({ type: 'not_expense', message: 'Ce document ne semble pas contenir de dépense.', reason: data.reason || '' });
        return;
      }

      // Pré-remplissage des champs
      const updates = {};
      if (data.amount != null)  updates.unit   = String(data.amount);
      if (data.detail)          updates.detail = data.detail;
      if (data.category && CATEGORIES[data.category]) {
        updates.category = data.category;
        const catSubs = CATEGORIES[data.category].subs || [];
        updates.sub = catSubs.includes(data.subcategory) ? data.subcategory : catSubs[0] || '';
      }
      setForm(f => ({ ...f, ...updates }));

      if ((data.confidence ?? 1) < 0.5) {
        setScanFeedback({ type: 'warning', message: 'Lecture incertaine, vérifiez les montants' });
      } else {
        setScanFeedback({ type: 'success', message: data.document_type || 'document' });
      }

    } catch (err) {
      setScanFeedback({ type: 'error', message: err.message || "Erreur lors de l'analyse" });
    } finally {
      setScanLoading(false);
    }
  };

  const handleSave = async () => {
    const isBudgetEvent = currentEvent?.event_type === "budget";
    // Pour Budget : included = tous les participants automatiquement
    const finalIncluded = isBudgetEvent ? participants : form.included;
    if (!form.eventId || !form.category || !form.sub || !form.detail) {
      addToast(t("toast_fill_all"), "warning"); return;
    }
    if (form.detail.trim().length < 2) {
      addToast(t ? t("validation_required") : "La description doit contenir au moins 2 caractères.", "warning"); return;
    }
    if (!isBudgetEvent && finalIncluded.length === 0) {
      addToast(t ? t("exp_select_person") : "Sélectionnez au moins une personne.", "warning"); return;
    }
    if (!unpaid && !form.paidBy) {
      addToast(t ? t("exp_select_paid_by") : "Sélectionnez un responsable.", "warning"); return;
    }
    const amountError = validateAmount(form.qty, form.unit);
    if (amountError) { addToast(amountError, "warning"); return; }
    setSaving(true);
    const qty = Number(form.qty);
    const unit = Number(form.unit);
    const totalAmount = qty * unit;

    if (editingEx) {
      // Modification : ajuster la contribution du payeur seulement si la charge était réglée
      const oldTotal = editingEx.qty * (editingEx.unit_price ?? 0);
      const oldPayer = editingEx.paid_by;
      const newPayer = form.paidBy;
      const wasUnpaid = editingEx.is_unpaid || false;

      if (!wasUnpaid && !unpaid) {
        // Les deux versions sont réglées — ajuster le delta
        const evContribs = contributions[form.eventId] || [];
        const getContrib = (name) => (evContribs.find(c => c.participant === name)?.amount || 0);
        if (oldPayer === newPayer) {
          const current = getContrib(newPayer);
          await upsertContribution(form.eventId, newPayer, Math.max(0, current - oldTotal + totalAmount), user.id);
        } else {
          const oldCurrent = getContrib(oldPayer);
          await upsertContribution(form.eventId, oldPayer, Math.max(0, oldCurrent - oldTotal), user.id);
          const newCurrent = getContrib(newPayer);
          await upsertContribution(form.eventId, newPayer, newCurrent + totalAmount, user.id);
        }
      } else if (wasUnpaid && !unpaid) {
        // Charge qui était non réglée, maintenant réglée → créditer le payeur
        const evContribs = contributions[form.eventId] || [];
        const currentContrib = evContribs.find(c => c.participant === newPayer)?.amount || 0;
        await upsertContribution(form.eventId, newPayer, currentContrib + totalAmount, user.id);
      } else if (!wasUnpaid && unpaid) {
        // Charge qui était réglée, maintenant non réglée → décréditer l'ancien payeur
        const evContribs = contributions[form.eventId] || [];
        const currentContrib = evContribs.find(c => c.participant === oldPayer)?.amount || 0;
        await upsertContribution(form.eventId, oldPayer, Math.max(0, currentContrib - oldTotal), user.id);
      }
      // Si wasUnpaid && unpaid → rien à faire

      await updateExpense(editingEx.id, { ...form, included: finalIncluded, qty, unit, is_unpaid: unpaid }, user.id, editingEx);
      addToast(t("toast_expense_edited"), "success");
    } else {
      // Nouvelle charge
      await createExpense({ ...form, included: finalIncluded, qty, unit, is_unpaid: unpaid }, user.id);

      // Créditer le payeur seulement si la charge est réglée
      if (!unpaid) {
        const evContribs = contributions[form.eventId] || [];
        const currentContrib = evContribs.find(c => c.participant === form.paidBy)?.amount || 0;
        await upsertContribution(form.eventId, form.paidBy, currentContrib + totalAmount, user.id);
      }

      addToast(t("toast_expense_added"), "success");
    }
    await reload(); setForm(empty); setEditingEx(null); setShowForm(false); setUnpaid(false); setSaving(false);
  };

  const startEdit = (ex) => {
    setForm({ eventId: ex.event_id, category: ex.category, sub: ex.sub_category || "", detail: ex.detail, qty: ex.qty, unit: ex.unit_price ?? 0, paidBy: ex.paid_by || "", included: [...(ex.included || [])], comment: ex.comment || "" });
    setUnpaid(ex.is_unpaid || false);
    setEditingEx(ex); setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (ex) => {
    setConfirm({
      message: `Supprimer la charge "${ex.detail}" ?`,
      onConfirm: async () => {
        // Décrémenter la contribution du payeur seulement si la charge était réglée
        if (!ex.is_unpaid && ex.paid_by) {
          const evContribs = contributions[ex.event_id] || [];
          const currentContrib = evContribs.find(c => c.participant === ex.paid_by)?.amount || 0;
          const totalAmount = ex.qty * (ex.unit_price ?? 0);
          await upsertContribution(ex.event_id, ex.paid_by, Math.max(0, currentContrib - totalAmount), user.id);
        }
        await deleteExpense(ex, user.id);
        await reload();
        setConfirm(null);
        addToast(t("toast_expense_deleted"), "info");
      },
      onCancel: () => setConfirm(null),
    });
  };

  const handleShowHistory = async (ex) => {
    setAuditModal(ex);
    setAuditLogs([]);
    setAuditLoading(true);
    const { data } = await fetchAuditLogs('expenses', ex.id);
    setAuditLogs(data || []);
    setAuditLoading(false);
  };

  // Filtrage et tri
  let filtered = filterEvent === "all" ? expenses : expenses.filter(e => e.event_id === filterEvent);
  if (filterCategory !== "all") filtered = filtered.filter(e => e.category === filterCategory);
  if (searchText.trim()) {
    const q = searchText.toLowerCase();
    filtered = filtered.filter(e =>
      e.detail?.toLowerCase().includes(q) ||
      e.paid_by?.toLowerCase().includes(q) ||
      e.sub_category?.toLowerCase().includes(q) ||
      e.comment?.toLowerCase().includes(q)
    );
  }
  filtered = [...filtered].sort((a, b) => {
    const ta = a.qty * (a.unit_price ?? 0);
    const tb = b.qty * (b.unit_price ?? 0);
    if (sortBy === "amount_desc") return tb - ta;
    if (sortBy === "amount_asc") return ta - tb;
    if (sortBy === "date_asc") return new Date(a.created_at) - new Date(b.created_at);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}

      {auditModal && (
        <Modal title={`🕐 Historique — ${auditModal.detail}`} onClose={() => { setAuditModal(null); setAuditLogs([]); }}>
          {auditLoading ? (
            <div style={{ textAlign: "center", padding: 40 }}><Spinner fullscreen={false} /></div>
          ) : auditLogs.length === 0 ? (
            <EmptyState icon="📋" title="Aucun historique" subtitle="Aucune modification enregistrée pour cette charge." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto" }}>
              {auditLogs.map(log => (
                <div key={log.id} style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                      background: log.action === 'INSERT' ? "#E8F5E9" : log.action === 'UPDATE' ? "#E3F2FD" : "#FFEBEE",
                      color: log.action === 'INSERT' ? "#2E7D32" : log.action === 'UPDATE' ? "#1565C0" : "#C62828" }}>
                      {log.action === 'INSERT' ? '✚ Ajout' : log.action === 'UPDATE' ? '✏️ Modification' : '🗑 Suppression'}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-sub)" }}>
                      {new Date(log.performed_at).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  {log.action === 'UPDATE' && log.old_values && log.new_values && (
                    <div style={{ fontSize: 12, color: "var(--text-sub)", display: "flex", flexDirection: "column", gap: 3 }}>
                      {log.old_values.detail !== log.new_values.detail && (
                        <div>Détail : <span style={{ color: "#C62828", textDecoration: "line-through" }}>{log.old_values.detail}</span> → <span style={{ color: "#2E7D32" }}>{log.new_values.detail}</span></div>
                      )}
                      {String(log.old_values.unit_price) !== String(log.new_values.unit_price) && (
                        <div>Montant : <span style={{ color: "#C62828" }}>{log.old_values.unit_price}</span> → <span style={{ color: "#2E7D32" }}>{log.new_values.unit_price}</span></div>
                      )}
                      {log.old_values.paid_by !== log.new_values.paid_by && (
                        <div>Payé par : <span style={{ color: "#C62828" }}>{log.old_values.paid_by || "—"}</span> → <span style={{ color: "#2E7D32" }}>{log.new_values.paid_by || "—"}</span></div>
                      )}
                    </div>
                  )}
                  {log.action === 'INSERT' && log.new_values && (
                    <div style={{ fontSize: 12, color: "var(--text-sub)" }}>
                      {log.new_values.detail} · {log.new_values.unit_price} {log.new_values.qty > 1 ? `× ${log.new_values.qty}` : ""}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {!hideHeader && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>Charges</h2>
          <p style={{ color: "#888", fontSize: 12 }}>{expenses.length} dépense{expenses.length > 1 ? "s" : ""}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {filterEvent !== "all" && events.find(e => e.id === filterEvent) && (
            <button onClick={() => {
              const ev = events.find(e => e.id === filterEvent);
              const evExp = expenses.filter(e => e.event_id === filterEvent);
              exportChargesPDF(ev, evExp);
            }} style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }}>📄 PDF Charges</button>
          )}
          <button onClick={() => {
            if (showForm || showOCR || showChoice) { closeAll(); setEditingEx(null); }
            else { setShowChoice(true); }
          }}
            style={S.btnDark}>{(showForm && !editingEx) || showOCR || showChoice ? "× Fermer" : "+ Ajouter"}</button>
        </div>
      </div>}
      {hideHeader && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
        <button onClick={() => {
          if (showForm || showOCR || showChoice) { closeAll(); setEditingEx(null); }
          else { setShowChoice(true); }
        }}
          style={S.btnDark}>{(showForm && !editingEx) || showOCR || showChoice ? "× Fermer" : "+ Ajouter une charge"}</button>
      </div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {/* Recherche texte */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--input-bg)", borderRadius: 10, padding: "8px 12px", border: "1.5px solid var(--border)", flex: isMobile ? "1 1 100%" : "1 1 180px", minWidth: 140 }}>
          <span style={{ opacity: 0.5, fontSize: 13 }}>🔍</span>
          <input
            placeholder="Rechercher une charge..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, width: "100%", fontFamily: "inherit" }}
          />
          {searchText && <button onClick={() => setSearchText("")} style={{ background: "none", border: "none", color: "var(--text-sub)", cursor: "pointer", fontSize: 15, padding: 0 }}>×</button>}
        </div>
        <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          <option value="all">Tous les événements ({expenses.length})</option>
          {events.map(ev => {
            const count = expenses.filter(e => e.event_id === ev.id).length;
            return <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name} ({count})</option>;
          })}
        </select>
        <select style={{ ...S.input, width: "auto" }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="all">{t ? t("exp_all_categories") : "Toutes catégories"}</option>
          {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{CATEGORIES[c].icon} {c}</option>)}
        </select>
        <select style={{ ...S.input, width: "auto" }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="date_desc">{t ? t("exp_sort_recent") : "📅 Plus récent"}</option>
          <option value="date_asc">{t ? t("exp_sort_oldest") : "📅 Plus ancien"}</option>
          <option value="amount_desc">{t ? t("exp_sort_amount_desc") : "💰 Montant ↓"}</option>
          <option value="amount_asc">{t ? t("exp_sort_amount_asc") : "💰 Montant ↑"}</option>
        </select>
        {(filterEvent !== "all" || filterCategory !== "all" || searchText) && (
          <button onClick={() => { setFilterEvent("all"); setFilterCategory("all"); setSearchText(""); }} style={{ ...S.btnGhost, padding: "8px 12px", fontSize: 12 }}>
            × Réinitialiser
          </button>
        )}
        {filtered.length !== expenses.length && (
          <span style={{ fontSize: 12, color: "var(--text-sub)" }}>{filtered.length} résultat{filtered.length > 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Bandeau info si événement Budget sélectionné */}
      {filterEvent !== "all" && events.find(e => e.id === filterEvent)?.event_type === "budget" && (
        <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span style={{ fontSize: 16 }}>🏦</span>
          <div>
            <span style={{ fontWeight: 700, color: "#F57F17" }}>Événement Budget</span>
            <span style={{ color: "#E65100", marginLeft: 8 }}>— Les charges ici représentent les dépenses effectuées par les responsables. Gérez les cotisations dans l'onglet <strong>Cotisations</strong>.</span>
          </div>
        </div>
      )}

      {/* Écran de choix : Scanner ou Saisie manuelle */}
      {showChoice && !showOCR && !showForm && (
        <div style={{ ...S.card, marginBottom: 16, border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16, textAlign: "center" }}>
            Comment souhaitez-vous ajouter cette charge ?
          </div>
          <div style={{ display: "flex", gap: 12, flexDirection: isMobile ? "column" : "row" }}>
            <button
              onClick={() => { setShowOCR(true); setShowChoice(false); }}
              style={{
                flex: 1, padding: "20px 16px", borderRadius: 12,
                border: "1.5px solid var(--border)", background: "var(--bg-secondary)",
                cursor: "pointer", fontFamily: "inherit", transition: "border-color 0.15s",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#1565C0"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
            >
              <span style={{ fontSize: 32 }}>📷</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Scanner un reçu</div>
                <div style={{ fontSize: 11, color: "var(--text-sub)", lineHeight: 1.5 }}>
                  Prenez une photo ou importez une image — les données sont extraites automatiquement.
                </div>
              </div>
            </button>
            <button
              onClick={() => { setForm(empty); setEditingEx(null); setShowForm(true); setShowChoice(false); setScanFeedback(null); }}
              style={{
                flex: 1, padding: "20px 16px", borderRadius: 12,
                border: "1.5px solid var(--border)", background: "var(--bg-secondary)",
                cursor: "pointer", fontFamily: "inherit", transition: "border-color 0.15s",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#0F0F0F"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
            >
              <span style={{ fontSize: 32 }}>✏️</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Saisie manuelle</div>
                <div style={{ fontSize: 11, color: "var(--text-sub)", lineHeight: 1.5 }}>
                  Remplissez le formulaire directement avec le montant, la catégorie et les participants.
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {showOCR && (
        <OCRCapture
          isMobile={isMobile}
          onClose={() => { setShowOCR(false); setShowChoice(true); }}
          onManualEntry={() => {
            setShowOCR(false);
            setShowChoice(false);
            setForm(empty);
            setEditingEx(null);
            setShowForm(true);
          }}
          onFill={(extracted) => {
            setForm(f => ({
              ...f,
              detail:   extracted.detail    || f.detail,
              unit:     extracted.unit      || f.unit,
              qty:      extracted.qty       || f.qty,
              comment:  extracted.comment   || f.comment,
              category: extracted.category  || f.category,
              sub:      extracted.sub       || f.sub,
            }));
            setShowOCR(false);
            setShowForm(true);
            setEditingEx(null);
          }}
        />
      )}

      {showForm && (
        <div style={{ ...S.card, marginBottom: 16, border: editingEx ? "1.5px solid #F57F17" : "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: editingEx ? 16 : 10 }}>
            <div style={S.sectionTitle}>{editingEx ? "✏️ Modifier la charge" : "➕ Nouvelle charge"}</div>
            {editingEx && <span style={{ fontSize: 11, color: "#F57F17", fontWeight: 600 }}>Mode édition</span>}
          </div>

          {/* Bouton scan inline — nouvelle charge uniquement */}
          {!editingEx && (
            <div style={{ marginBottom: 16 }}>
              <input
                ref={scanRef}
                type="file"
                accept="image/*,.pdf"
                {...(isMobile ? { capture: "environment" } : {})}
                onChange={handleScanFile}
                style={{ display: "none" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => !scanLoading && scanRef.current?.click()}
                  disabled={scanLoading}
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    padding: "7px 14px", borderRadius: 8,
                    border: "1.5px solid var(--border)", background: "var(--bg-secondary)",
                    cursor: scanLoading ? "not-allowed" : "pointer", fontFamily: "inherit",
                    fontSize: 12, color: "var(--text-sub)", opacity: scanLoading ? 0.75 : 1,
                    transition: "border-color 0.15s",
                  }}
                  onMouseEnter={e => { if (!scanLoading) e.currentTarget.style.borderColor = "#1565C0"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
                >
                  {scanLoading
                    ? <><div style={{ width: 12, height: 12, border: "2px solid #1565C0", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />Analyse du document...</>
                    : "📷 Scanner un document"
                  }
                </button>

                {scanFeedback && !scanLoading && (
                  <div
                    role={scanFeedback.type === 'error' || scanFeedback.type === 'not_expense' ? "alert" : "status"}
                    style={{
                      fontSize: 12, padding: "5px 12px", borderRadius: 8, lineHeight: 1.5,
                      background:
                        scanFeedback.type === "success"   ? "#E8F5E9" :
                        scanFeedback.type === "warning"   ? "#FFF8E1" : "#FFF3E0",
                      color:
                        scanFeedback.type === "success"   ? "#2E7D32" :
                        scanFeedback.type === "warning"   ? "#E65100" : "#BF360C",
                      border: `1px solid ${
                        scanFeedback.type === "success"   ? "#C8E6C9" :
                        scanFeedback.type === "warning"   ? "#FFE082" : "#FFCCBC"
                      }`,
                    }}
                  >
                    {scanFeedback.type === "success"     && `✓ Document reconnu : ${scanFeedback.message}`}
                    {scanFeedback.type === "warning"     && `⚠️ ${scanFeedback.message}`}
                    {scanFeedback.type === "not_expense" && `${scanFeedback.message}${scanFeedback.reason ? ` — ${scanFeedback.reason}` : ""}`}
                    {scanFeedback.type === "error"       && `⚠️ ${scanFeedback.message}`}
                  </div>
                )}
              </div>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          {/* Bandeau Budget */}
          {currentEvent?.event_type === "budget" && (
            <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#F57F17" }}>
              {t ? t("exp_budget_info") : "🏦 Événement Budget — Enregistrez les dépenses effectuées."}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={S.label}>Événement <span style={{ color: "#C62828" }}>*</span></label>
              <select style={{ ...S.input, borderColor: !form.eventId ? "#FFB74D" : "#4CAF50" }} value={form.eventId} onChange={e => handleEventChange(e.target.value)} disabled={!!editingEx || !!defaultEventId}>
                <option value="">{t ? t("exp_select_placeholder") : "Sélectionner..."}</option>
                {events.filter(e => e.status === "open").map(ev => <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>{currentEvent?.event_type === "budget" ? t ? t("exp_responsible") : "Responsable de la dépense" : "Payé par"} {!unpaid && <span style={{ color: "#C62828" }}>*</span>}</label>
              <select style={{ ...S.input, opacity: unpaid ? 0.5 : 1, borderColor: !unpaid && form.eventId && !form.paidBy ? "#FFB74D" : !unpaid && form.paidBy ? "#4CAF50" : undefined }}
                value={form.paidBy} onChange={e => setForm({ ...form, paidBy: e.target.value })} disabled={!currentEvent || unpaid}>
                <option value="">{t ? t("exp_select_placeholder") : "Sélectionner..."}</option>
                {participants.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {!unpaid && form.eventId && !form.paidBy && <div style={{ fontSize: 11, color: "#F57F17", marginTop: 4 }}>⚠️ Requis</div>}
            </div>
          </div>

          {/* Toggle charge non réglée — masqué pour Budget */}
          {currentEvent?.event_type !== "budget" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "12px 16px", borderRadius: 12, background: unpaid ? "#FFF8E1" : "#fafafa", border: `1.5px solid ${unpaid ? "#F57F17" : "#eee"}`, transition: "all 0.2s" }}>
              <div style={{ position: "relative", width: 40, height: 22, flexShrink: 0 }} onClick={() => { setUnpaid(!unpaid); if (!unpaid) setForm(f => ({ ...f, paidBy: "" })); }}>
                <div style={{ position: "absolute", inset: 0, background: unpaid ? "#F57F17" : "#ddd", borderRadius: 11, transition: "background 0.2s" }} />
                <div style={{ position: "absolute", top: 3, left: unpaid ? 21 : 3, width: 16, height: 16, background: "#fff", borderRadius: "50%", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: unpaid ? "#E65100" : "#333" }}>⏳ Charge non encore réglée</div>
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{unpaid ? "Aucune contribution ne sera créditée." : "Décochez si personne n'a encore payé."}</div>
              </div>
            </label>
          </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div><label style={S.label}>Catégorie <span style={{ color: "#C62828" }}>*</span></label>
              <select style={{ ...S.input, borderColor: form.category ? "#4CAF50" : form.eventId ? "#FFB74D" : undefined }}
                value={form.category} onChange={e => setForm({ ...form, category: e.target.value, sub: "" })}>
                <option value="">{t ? t("exp_select_placeholder") : "Sélectionner..."}</option>
                {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{CATEGORIES[c].icon} {c}</option>)}
              </select>
            </div>
            <div><label style={S.label}>Sous-catégorie <span style={{ color: "#C62828" }}>*</span></label>
              <select style={{ ...S.input, borderColor: form.sub ? "#4CAF50" : form.category ? "#FFB74D" : undefined }}
                value={form.sub} onChange={e => setForm({ ...form, sub: e.target.value })} disabled={!form.category}>
                <option value="">{t ? t("exp_select_placeholder") : "Sélectionner..."}</option>
                {form.category && CATEGORIES[form.category].subs.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={S.label}>Détail / Nature <span style={{ color: "#C62828" }}>*</span></label>
            <input style={{ ...S.input, borderColor: form.detail.trim() ? "#4CAF50" : form.category ? "#FFB74D" : undefined, transition: "border-color 0.2s" }}
              placeholder="Ex: Vin rouge Côtes du Rhône, Salade César..." value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} maxLength={100} />
            {form.detail && <div style={{ fontSize: 10, color: "#aaa", marginTop: 2, textAlign: "right" }}>{form.detail.length}/100</div>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
            <div><label style={S.label}>Quantité</label><input type="number" min="1" max="10000" step="1" style={S.input} value={form.qty} onChange={e => setForm({ ...form, qty: Math.floor(Math.abs(Number(e.target.value))) || 1 })} /></div>
            <div><label style={S.label}>Prix unitaire <span style={{ color: "#C62828" }}>*</span></label>
              <input type="number" min="0" step="0.01" style={{ ...S.input, borderColor: Number(form.unit) > 0 ? "#4CAF50" : form.detail ? "#FFB74D" : undefined }}
                value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
              {Number(form.unit) <= 0 && form.detail && <div style={{ fontSize: 11, color: "#F57F17", marginTop: 3 }}>⚠️ Montant requis</div>}
            </div>
            <div><label style={S.label}>Total auto</label>
              <div style={{ ...S.input, background: total > 0 ? "#f0faf4" : "#f8f8f8", color: total > 0 ? "#2E7D32" : "#aaa", fontWeight: 700, display: "flex", alignItems: "center" }}>
                {total.toFixed(2)} {currencySymbol(currentEvent?.currency)}
              </div>
            </div>
          </div>
          {currentEvent && currentEvent.event_type !== "budget" && (
            <div style={{ marginBottom: 16, padding: 16, background: "var(--hover-bg)", borderRadius: 12, border: "1px solid var(--border)" }}>
              <ParticipantToggle people={participants} selected={form.included} onChange={p => setForm({ ...form, included: p })} label="Qui partage cette charge ?" />
              {form.included.length > 0 && total > 0 && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "#E8F5E9", borderRadius: 10, fontSize: 13, color: "#2E7D32", fontWeight: 600 }}>
                  ➗ {sharePerPerson.toFixed(2)} {currencySymbol(currentEvent?.currency)} / personne · {form.included.length} inclus
                </div>
              )}
              {form.included.length === 0 && <div style={{ marginTop: 8, fontSize: 12, color: "#C62828" }}>⚠️ Sélectionnez au moins une personne</div>}
            </div>
          )}
          {currentEvent && currentEvent.event_type === "budget" && (
            <div style={{ background: "#E8F5E9", border: "1px solid #C8E6C9", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#2E7D32" }}>
              ✓ Cette charge sera attribuée à l'ensemble des participants de l'événement ({participants.length} personnes).
            </div>
          )}
          {/* Commentaire optionnel */}
          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>💬 Commentaire (optionnel)</label>
            <textarea
              style={{ ...S.input, resize: "vertical", minHeight: 64, fontFamily: "inherit", lineHeight: 1.5 }}
              placeholder="Ex: Remboursement pour le billet d'Alice achetée en avance..."
              value={form.comment || ""}
              onChange={e => setForm({ ...form, comment: e.target.value })}
              maxLength={300}
            />
            {form.comment && <div style={{ fontSize: 10, color: "#aaa", marginTop: 3, textAlign: "right" }}>{form.comment.length}/300</div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={{ ...S.btnDark, opacity: saving ? 0.6 : 1 }}>{saving ? "Enregistrement..." : editingEx ? "Enregistrer les modifications" : "Ajouter la charge"}</button>
            <button onClick={() => { setShowForm(false); setEditingEx(null); setForm(empty); setScanFeedback(null); setScanLoading(false); }} style={S.btnGhost}>Annuler</button>
          </div>
          {/* Aide visuelle champs manquants */}
          {(!form.eventId || !form.category || !form.sub || !form.detail || Number(form.unit) <= 0) && (
            <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {!form.eventId && <span style={{ fontSize: 11, color: "#F57F17" }}>· Événement requis</span>}
              {!form.category && <span style={{ fontSize: 11, color: "#F57F17" }}>· Catégorie requise</span>}
              {form.category && !form.sub && <span style={{ fontSize: 11, color: "#F57F17" }}>· Sous-catégorie requise</span>}
              {!form.detail && <span style={{ fontSize: 11, color: "#F57F17" }}>· Détail requis</span>}
              {Number(form.unit) <= 0 && <span style={{ fontSize: 11, color: "#F57F17" }}>· Montant requis</span>}
            </div>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon="🧾" title="Aucune charge" subtitle={filterEvent === "all" ? "Aucune dépense enregistrée." : "Aucune dépense pour cet événement."}
          action={<button onClick={() => setShowForm(true)} style={S.btnDark}>+ Ajouter une charge</button>} />
      ) : isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(ex => {
            const cat = CATEGORIES[ex.category];
            const ev = events.find(e => e.id === ex.event_id);
            const evSym = currencySymbol(ev?.currency);
            const t = ex.qty * (ex.unit_price ?? 0);
            const inc = ex.included || [];
            const share = inc.length > 0 ? t / inc.length : 0;
            return (
              <div key={ex.id} style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", border: "1px solid #eee" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{cat?.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail}</div>
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ev?.name} · {ex.is_unpaid ? <span style={{ color: "#F57F17", fontWeight: 600 }}>⏳ Non réglée</span> : `par ${ex.paid_by}`}
                      </div>
                      {ex.comment && <div style={{ fontSize: 11, color: "#888", marginTop: 3, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {ex.comment}</div>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(t, evSym)}</div>
                    <div style={{ fontSize: 11, color: "#2E7D32", fontWeight: 600 }}>{fmt(share, evSym)}/p.</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {cat && <Badge label={ex.sub_category} color={cat.color} accent={cat.accent} />}
                    {ex.is_unpaid && <Badge label="⏳ Non réglée" color="#FFF8E1" accent="#F57F17" />}
                    <AvatarStack names={inc} size={18} />
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => handleShowHistory(ex)} title="Historique" style={{ padding: "4px 10px", borderRadius: 8, border: "1.5px solid #e0e0e0", background: "#fff", fontSize: 12, cursor: "pointer" }}>🕐</button>
                    {ev?.status === "open" && (
                      <>
                        <button onClick={() => startEdit(ex)} style={{ padding: "4px 10px", borderRadius: 8, border: "1.5px solid #e0e0e0", background: "#fff", fontSize: 12, cursor: "pointer" }}>✏️</button>
                        <button onClick={() => handleDelete(ex)} style={{ padding: "4px 10px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", fontSize: 12, cursor: "pointer" }}>🗑️</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ overflowX: "auto", width: "100%" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr style={{ background: "#f8f8f8", borderBottom: "1.5px solid #eee" }}>
                {[t ? t("exp_col_category") : "Catégorie", t ? t("exp_col_detail") : "Détail", t ? t("exp_col_event") : "Événement", t ? t("exp_col_qty") : "Qté", t ? t("exp_col_unit") : "Unitaire", t ? t("exp_col_total") : "Total", t ? t("exp_col_share") : "Part/p.", t ? t("exp_col_paid_by") : "Payé par", t ? t("exp_col_comment") : "Commentaire", t ? t("exp_col_included") : "Inclus", ""].map(h => (
                  <th key={h} style={{ padding: "12px 12px", fontSize: 10, fontWeight: 700, color: "#999", textAlign: "left", textTransform: "uppercase", letterSpacing: 0.7, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ex, i) => {
                const cat = CATEGORIES[ex.category];
                const ev = events.find(e => e.id === ex.event_id);
                const evSym = currencySymbol(ev?.currency);
                const t = ex.qty * (ex.unit_price ?? 0);
                const inc = ex.included || [];
                const share = inc.length > 0 ? t / inc.length : 0;
                return (
                  <tr key={ex.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid #f5f5f5" : "none", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#fafafa"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "11px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ fontSize: 16 }}>{cat?.icon}</span>
                        {cat && <Badge label={ex.sub_category} color={cat.color} accent={cat.accent} />}
                      </div>
                    </td>
                    <td style={{ padding: "11px 12px", fontSize: 13, maxWidth: 180 }}><Truncate text={ex.detail} max={25} /></td>
                    <td style={{ padding: "11px 12px", fontSize: 12, color: "#777", maxWidth: 140 }}><Truncate text={ev?.name} max={18} /></td>
                    <td style={{ padding: "11px 12px", fontSize: 13, textAlign: "center" }}>{ex.qty}</td>
                    <td style={{ padding: "11px 12px", fontSize: 13, whiteSpace: "nowrap" }}>{fmt(ex.unit_price ?? 0, evSym)}</td>
                    <td style={{ padding: "11px 12px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{fmt(t, evSym)}</td>
                    <td style={{ padding: "11px 12px", fontSize: 12, color: "#2E7D32", fontWeight: 700, whiteSpace: "nowrap" }}>{fmt(share, evSym)}</td>
                    <td style={{ padding: "11px 12px" }}>
                      {ex.is_unpaid ? (
                        <span style={{ background: "#FFF8E1", color: "#F57F17", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 8 }}>⏳ Non réglée</span>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Avatar name={ex.paid_by || "?"} size={20} />
                          <span style={{ fontSize: 12, maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.paid_by}</span>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "11px 12px", maxWidth: 160 }}>
                      {ex.comment && <span style={{ fontSize: 11, color: "#888", fontStyle: "italic", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ex.comment}>💬 {ex.comment}</span>}
                    </td>
                    <td style={{ padding: "11px 12px" }}><AvatarStack names={inc} size={20} /></td>
                    <td style={{ padding: "11px 12px" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => handleShowHistory(ex)} title="Historique" style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #e0e0e0", background: "#fff", fontSize: 12, cursor: "pointer" }}>🕐</button>
                        {ev?.status === "open" && (
                          <>
                            <button onClick={() => startEdit(ex)} style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #e0e0e0", background: "#fff", fontSize: 12, cursor: "pointer" }}>✏️</button>
                            <button onClick={() => handleDelete(ex)} style={{ padding: "4px 8px", borderRadius: 7, border: "1.5px solid #ffcdd2", background: "#fff5f5", fontSize: 12, cursor: "pointer" }}>🗑️</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
