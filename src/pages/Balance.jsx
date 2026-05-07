// src/pages/Balance.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { upsertContribution, recordPayment, fetchPayments, exportPDF } from "../supabase.js";
import { useTranslation } from "../i18n.jsx";

export function Balance({ events, expenses, contributions, user, reload, isMobile, addToast, t, initialEvent, hideHeader }) {
  const [filterEvent, setFilterEvent] = useState(initialEvent || events[0]?.id || "");
  const [settleModal, setSettleModal] = useState(null);
  const [versement, setVersement] = useState({});
  const [saving, setSaving] = useState(false);
  const [emojiPickerFor, setEmojiPickerFor] = useState(null);
  const [, forceUpdate] = useState(0); // Force re-render après changement d'emoji

  const ev = events.find(e => e.id === filterEvent);
  const evExp = expenses.filter(e => e.event_id === filterEvent);
  const sym = currencySymbol(ev?.currency);
  const participants = (ev?.event_participants || []).map(p => p.name);
  const evContribMap = {};
  (contributions[filterEvent] || []).forEach(c => { evContribMap[c.participant] = c.amount; });

  // Nouvelle logique Solder :
  // - Débiteur (net < -1) : redistribue sa part aux créditeurs par priorité (celui à qui on doit le plus en premier)
  // - Cas exceptionnel (tout le monde équilibré mais des créditeurs subsistent) : ancienne logique
  const handleSettle = (person) => {
    const net = computeNetBalance(evExp, evContribMap, person);
    const owed = computeOwed(evExp, person);
    const current = evContribMap[person] || 0;

    if (net < -1) {
      // Débiteur : calcule vers qui redistribuer
      const debt = Math.abs(net);
      // Trouver les créditeurs (ceux qui ont trop payé), triés par montant décroissant
      const creditors = participants
        .filter(p => p !== person)
        .map(p => ({ name: p, net: computeNetBalance(evExp, evContribMap, p) }))
        .filter(p => p.net > 1)
        .sort((a, b) => b.net - a.net);

      let redistributionMsg = "";
      if (creditors.length > 0) {
        // Construire le message de redistribution
        let remaining = debt;
        const parts = [];
        for (const c of creditors) {
          if (remaining <= 0.01) break;
          const pay = Math.min(remaining, c.net);
          parts.push(`${fmt(pay, sym)} → ${c.name}`);
          remaining -= pay;
        }
        redistributionMsg = `\n\nRépartition : ${parts.join(", ")}${remaining > 0.01 ? ` (reste ${fmt(remaining, sym)} non attribué)` : ""}`;
      }

      const newAmount = current + debt;
      const message = `Versement de ${fmt(debt, sym)} enregistré pour ${person}.${redistributionMsg}`;
      setSettleModal({ person, newAmount, message });
    } else if (net > 1) {
      // Cas exceptionnel : créditeur mais tout le monde est équilibré par ailleurs
      const allOthersSettled = participants
        .filter(p => p !== person)
        .every(p => Math.abs(computeNetBalance(evExp, evContribMap, p)) <= 1);
      if (allOthersSettled) {
        const newAmount = owed;
        const message = `Contribution de ${person} ajustée à ${fmt(owed, sym)}. L'excédent est annulé.`;
        setSettleModal({ person, newAmount, message });
      }
    }
  };

  const confirmSettle = async () => {
    if (!settleModal) return;
    setSaving(true);
    await upsertContribution(filterEvent, settleModal.person, settleModal.newAmount, user.id);
    await reload();
    addToast(`${settleModal.person} soldé avec succès.`, "success");
    setSaving(false); setSettleModal(null);
  };

  const handleVersement = async (person) => {
    const amount = parseFloat(versement[person] || 0);
    if (!amount || amount <= 0) { addToast("Entrez un montant valide.", "warning"); return; }
    const current = evContribMap[person] || 0;
    setSaving(true);
    await upsertContribution(filterEvent, person, current + amount, user.id);
    await recordPayment(filterEvent, person, amount, null, user.id);
    await reload();
    setVersement(v => ({ ...v, [person]: "" }));
    addToast(`Versement de ${fmt(amount, sym)} enregistré pour ${person}.`, "success");
    setSaving(false);
  };

  const transactions = participants.length > 0 ? computeTransactions(evExp, evContribMap, participants) : [];

  const handleExportPDF = () => {
    if (!ev) return;
    exportPDF(ev, evExp, evContribMap, participants);
    addToast("PDF généré !", "success");
  };

  const handleExportExcel = async () => {
    if (!ev || evExp.length === 0) { addToast("Aucune charge à exporter.", "warning"); return; }
    try {
      const sym = currencySymbol(ev.currency);
      // Données charges
      const expRows = evExp.map(ex => ({
        "Catégorie": ex.category || "",
        "Sous-catégorie": ex.sub_category || "",
        "Description": ex.detail || "",
        "Quantité": ex.qty,
        "Prix unitaire": ex.unit_price ?? 0,
        "Total": ex.qty * (ex.unit_price ?? 0),
        "Devise": sym,
        "Payé par": ex.is_unpaid ? "⏳ Non réglée" : (ex.paid_by || ""),
        "Participants": (ex.included || []).join(", "),
        "Commentaire": ex.comment || "",
      }));

      // Données soldes
      const balRows = participants.map(p => {
        const owed = computeOwed(evExp, p);
        const paid = evContribMap[p] || 0;
        const net = paid - owed;
        return {
          "Participant": p,
          "Part due": owed,
          "Versé": paid,
          "Solde": net,
          "Statut": Math.abs(net) <= 1 ? "Soldé" : net < 0 ? "Doit rembourser" : "À recevoir",
        };
      });

      // Créer le workbook manuellement (CSV multi-feuilles simulé)
      const toCSV = (rows) => {
        if (!rows.length) return "";
        const headers = Object.keys(rows[0]);
        const lines = [headers.join(";"), ...rows.map(r => headers.map(h => `"${r[h]}"`).join(";"))];
        return lines.join("\n");
      };

      const content = `CHARGES - ${ev.name}\n${toCSV(expRows)}\n\n\nSOLDES - ${ev.name}\n${toCSV(balRows)}`;
      const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
      const fileName = `SplitLy_${ev.name.replace(/\s+/g, "_")}_${ev.date}.csv`;

      // Fallback Share API pour iOS Safari (a.download ne fonctionne pas)
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, { type: "text/csv" })] })) {
        const file = new File([blob], fileName, { type: "text/csv" });
        await navigator.share({ files: [file], title: `Export SplitLy — ${ev.name}` });
        addToast("Export CSV partagé !", "success");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        addToast("Export CSV téléchargé !", "success");
      }
    } catch (e) {
      addToast("Erreur lors de l'export.", "error");
    }
  };

  return (
    <div>
      {settleModal && (
        <Modal title={`Solder ${settleModal.person}`} onClose={() => setSettleModal(null)}>
          <p style={{ fontSize: 14, color: "#444", marginBottom: 16, lineHeight: 1.5 }}>{settleModal.message}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={confirmSettle} disabled={saving} style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex" }}>{saving ? "..." : "✓ Confirmer"}</button>
            <button onClick={() => setSettleModal(null)} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
          </div>
        </Modal>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        {!hideHeader && <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>
            {ev?.event_type === "budget" ? "🏦 Budget" : (t ? t("bal_title") : "Répartition")}
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>
            {ev?.event_type === "budget" ? "Les événements Budget n'ont pas de répartition — voir l'onglet Cotisations" : (t ? t("bal_subtitle") : "Soldes calculés en temps réel")}
          </p>
        </div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!hideHeader && <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}</option>)}
          </select>}
          {ev?.event_type !== "budget" && <>
            <button onClick={handleExportPDF} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>{t ? t("bal_pdf") : "📄 PDF"}</button>
            <button onClick={handleExportExcel} style={{ ...S.btnGhost, padding: "8px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>📊 CSV</button>
          </>}
        </div>
      </div>

      {/* ── Si événement Budget → pas de répartition, rediriger vers Cotisations ── */}
      {ev?.event_type === "budget" && (
        <div style={{ background: "var(--bg-secondary)", borderRadius: 16, padding: 28, border: "1px solid var(--border)", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🏦</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
            Pas de répartition pour les événements Budget
          </div>
          <div style={{ fontSize: 13, color: "var(--text-sub)", maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>
            Les événements Budget fonctionnent avec des cotisations. Consultez l'onglet <strong>Cotisations</strong> pour voir les participations et le suivi de la collecte.
          </div>
        </div>
      )}

      {/* ── Si événement Split → vue Répartition normale ── */}
      {ev?.event_type !== "budget" && (participants.length === 0 ? (
        <EmptyState icon="👥" title={t ? t("bal_no_participants") : "Aucun participant"} subtitle={t ? t("bal_select_event") : "Sélectionnez un événement avec des participants."} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(Math.max(isMobile ? 2 : participants.length, 1), isMobile ? 2 : 4)}, 1fr)`, gap: 12, marginBottom: 20 }}>
            {participants.map(p => {
              const owed = computeOwed(evExp, p);
              const contrib = evContribMap[p] || 0;
              const net = contrib - owed;
              const settled = isSettled(net);
              const hasCharges = owed > 0;
              const status = settleStatus(net, hasCharges);
              return (
                <div key={p} style={{ background: "#fff", borderRadius: 14, padding: "16px 12px", border: `2px solid ${settled && hasCharges ? "#c8e6c9" : !hasCharges ? "#f0f0f0" : Math.abs(net) > 10 ? "#ffcdd2" : "#eee"}`, textAlign: "center", transition: "border-color 0.2s", position: "relative" }}>
                  {/* Bouton emoji */}
                  <button onClick={() => setEmojiPickerFor(emojiPickerFor === p ? null : p)}
                    title="Changer l'avatar"
                    style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", cursor: "pointer", fontSize: 14, opacity: 0.4, padding: 2 }}>
                    🎨
                  </button>
                  {emojiPickerFor === p && (
                    <div style={{ position: "absolute", top: 30, right: 0, zIndex: 100 }}>
                      <EmojiPicker name={p} onClose={() => { setEmojiPickerFor(null); forceUpdate(n => n + 1); }} />
                    </div>
                  )}
                  <Avatar name={p} size={36} />
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</div>
                  <div style={{ fontSize: 10, color: "#aaa", marginTop: 4 }}>{hasCharges ? `${t ? t("bal_owes") : "Doit:"} ${fmt(owed, sym)}` : (t ? t("bal_no_charges") : "Aucune charge")}</div>
                  <div style={{ fontSize: 10, color: "#aaa" }}>{hasCharges ? `${t ? t("bal_paid") : "Versé:"} ${fmt(contrib, sym)}` : ""}</div>
                  <div style={{ marginTop: 8, padding: "5px 8px", borderRadius: 8, background: status.bg, fontSize: 12, fontWeight: 700, color: status.color }}>
                    {status.label}
                  </div>
                  {(() => {
                    const isDebtor = !settled && hasCharges && net < -1 && ev?.status === "open";
                    const allOthersSettled = participants
                      .filter(x => x !== p)
                      .every(x => Math.abs(computeNetBalance(evExp, evContribMap, x)) <= 1);
                    const isExceptionalCreditor = !settled && hasCharges && net > 1 && allOthersSettled && ev?.status === "open";
                    return (isDebtor || isExceptionalCreditor) ? (
                    <div style={{ marginTop: 10, display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                      <input type="number" placeholder="Montant" min="0.01" step="0.01"
                        style={{ ...S.input, width: 68, padding: "5px 6px", fontSize: 11, textAlign: "center" }}
                        value={versement[p] || ""} onChange={e => setVersement(v => ({ ...v, [p]: e.target.value }))} />
                      <button onClick={() => handleVersement(p)} disabled={saving} style={{ ...S.btnDark, padding: "5px 8px", fontSize: 11, borderRadius: 8 }}>+</button>
                      <button onClick={() => handleSettle(p)} style={{ padding: "5px 8px", borderRadius: 8, border: "1.5px solid #2E7D32", background: "#E8F5E9", color: "#2E7D32", fontSize: 11, cursor: "pointer", fontWeight: 700, width: "100%" }}>
                        Solder
                      </button>
                    </div>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>

          {/* Résumé en langage naturel */}
          {transactions.length > 0 && (
            <div style={{ background: "#FFF8E1", borderRadius: 12, padding: "14px 18px", marginBottom: 16, border: "1px solid #FFE082" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#E65100", marginBottom: 8 }}>{t ? t("bal_summary") : "💬 En résumé"}</div>
              {transactions.map((tx, i) => (
                <div key={i} style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>
                  <strong>{tx.from}</strong> {t ? t("bal_must_pay") : "doit rembourser"} <strong>{fmt(tx.amount, sym)}</strong> {t ? t("bal_to") : "à"} <strong>{tx.to}</strong>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #eee", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t ? t("bal_reimbursements") : "Remboursements à effectuer"}</div>
              <span style={{ background: transactions.length > 0 ? "#FFF8E1" : "#E8F5E9", color: transactions.length > 0 ? "#F57F17" : "#2E7D32", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>
                {transactions.length > 0 ? `${transactions.length} ${t ? t("bal_pending") : "en attente"}` : participants.every(p => isExactlySettled(computeNetBalance(evExp, evContribMap, p))) ? (t ? t("bal_all_settled") : "✓ Tout soldé exactement") : "≈ Tout soldé (écarts < 1)"}
              </span>
            </div>
            {transactions.length === 0 ? (
              <EmptyState icon="🎉" title={t ? t("bal_no_reimbursements") : "Aucun remboursement nécessaire"} subtitle={t ? t("bal_all_balanced") : "Tous les soldes sont équilibrés."} />
            ) : (
              transactions.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: i < transactions.length - 1 ? "1px solid #f5f5f5" : "none" }}>
                  <Avatar name={t.from} size={30} />
                  <div style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
                    <span style={{ fontWeight: 700 }}><Truncate text={t.from} max={12} /></span>
                    <span style={{ color: "#aaa", margin: "0 6px" }}>→</span>
                    <span style={{ fontWeight: 700 }}><Truncate text={t.to} max={12} /></span>
                  </div>
                  <Avatar name={t.to} size={30} />
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Playfair Display', serif", flexShrink: 0 }}>{fmt(t.amount, sym)}</div>
                </div>
              ))
            )}
          </div>

          {/* Historique des versements */}
          <PaymentHistory eventId={filterEvent} sym={sym} />
        </>
      ))}
    </div>
  );
}

// ─── BUDGET CAISSE VIEW (placeholder Phase 4c) ───────────────
// ─── HISTORIQUE DES VERSEMENTS ────────────────────────────────
export function PaymentHistory({ eventId, sym }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!eventId || !show) return;
    setLoading(true);
    fetchPayments(eventId).then(({ data }) => {
      setPayments(data || []);
      setLoading(false);
    });
  }, [eventId, show]);

  return (
    <div style={{ marginTop: 16 }}>
      <button onClick={() => setShow(!show)}
        style={{ background: "#fafafa", border: "1px solid #eee", borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer", fontWeight: 600, width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>📋 Historique des versements</span>
        <span style={{ fontSize: 12, color: "#aaa" }}>{show ? "▲ Masquer" : "▼ Afficher"}</span>
      </button>
      {show && (
        <div style={{ background: "#fff", borderRadius: "0 0 12px 12px", border: "1px solid #eee", borderTop: "none", overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>Chargement...</div>
          ) : payments.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#aaa", fontSize: 13 }}>Aucun versement enregistré.</div>
          ) : (
            payments.map((p, i) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < payments.length - 1 ? "1px solid #f5f5f5" : "none" }}>
                <Avatar name={p.participant} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.participant}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{new Date(p.created_at).toLocaleString("fr-FR")}</div>
                  {p.note && <div style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>💬 {p.note}</div>}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#2E7D32" }}>+{fmt(p.amount, sym)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
export function GuestEditExpenseForm({ expense, events, onSubmit, onCancel, saving }) {
  const ev = events.find(e => e.id === expense.event_id);
  const participants = (ev?.event_participants || []).map(p => p.name);
  const [form, setForm] = useState({
    category: expense.category || "",
    sub: expense.sub_category || "",
    detail: expense.detail || "",
    qty: expense.qty || 1,
    unit: expense.unit_price || 0,
    paidBy: expense.paid_by || "",
    included: expense.included || [...participants],
    comment: expense.comment || "",
  });
  const total = (Number(form.qty) || 0) * (Number(form.unit) || 0);
  const sym = currencySymbol(ev?.currency);

  return (
    <div style={{ ...S.card, border: "1.5px solid #F57F17", marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: "#E65100" }}>✏️ Demande de modification</div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>
        Charge : <strong>{expense.detail}</strong> · Événement : <strong>{ev?.name}</strong>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div><label style={S.label}>Catégorie</label>
          <select style={S.input} value={form.category} onChange={e => setForm({ ...form, category: e.target.value, sub: "" })}>
            {Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{CATEGORIES[c].icon} {c}</option>)}
          </select>
        </div>
        <div><label style={S.label}>Sous-catégorie</label>
          <select style={S.input} value={form.sub} onChange={e => setForm({ ...form, sub: e.target.value })}>
            {form.category && CATEGORIES[form.category]?.subs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={S.label}>Description</label>
          <input style={S.input} value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} />
        </div>
        <div><label style={S.label}>Quantité</label>
          <input type="number" style={S.input} value={form.qty} min={1} onChange={e => setForm({ ...form, qty: Number(e.target.value) })} />
        </div>
        <div><label style={S.label}>Prix unitaire</label>
          <input type="number" style={S.input} value={form.unit} min={0} step={0.01} onChange={e => setForm({ ...form, unit: e.target.value })} />
        </div>
        <div><label style={S.label}>Payé par</label>
          <select style={S.input} value={form.paidBy} onChange={e => setForm({ ...form, paidBy: e.target.value })}>
            <option value="">Sélectionner...</option>
            {participants.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#0F0F0F" }}>
            Total : {fmt(total, sym)}
          </span>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Qui partage ?</label>
        <ParticipantToggle people={participants} selected={form.included} onChange={p => setForm({ ...form, included: p })} label="" />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={S.label}>Commentaire (optionnel)</label>
        <textarea style={{ ...S.input, minHeight: 56, resize: "vertical", fontFamily: "inherit" }}
          placeholder="Expliquez pourquoi vous souhaitez modifier cette charge..."
          value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} maxLength={300}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onSubmit(form)} disabled={saving}
          style={{ ...S.btnDark, background: "#E65100", flex: 1 }}>
          {saving ? "Envoi..." : "📤 Soumettre la modification"}
        </button>
        <button onClick={onCancel} style={S.btnGhost}>Annuler</button>
      </div>
    </div>
  );
}
