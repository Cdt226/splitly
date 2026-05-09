// src/pages/History.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { invalidateHistory } from "../supabase.js";
import { useTranslation } from "../i18n.jsx";

export function History({ events, history, user, reload, isMobile, addToast }) {
  const { t } = useTranslation ? useTranslation() : { t: (k) => k };
  const [filterEvent, setFilterEvent] = useState("all");
  const [confirm, setConfirm] = useState(null);
  const filtered = filterEvent === "all" ? history : history.filter(h => h.event_id === filterEvent);

  const handleRollback = (entry) => {
    const later = history.filter(h => h.event_id === entry.event_id && h.created_at >= entry.created_at && !h.invalidated);
    setConfirm({
      message: `Annuler "${entry.action}" du ${new Date(entry.created_at).toLocaleString("fr-FR")} ?`,
      warnings: later.length > 1 ? [`${later.length - 1} modification(s) ultérieure(s) seront également invalidées.`] : [],
      onConfirm: async () => {
        try {
          const before = entry.before_data;
          const after = entry.after_data;

          // ── Charges ──────────────────────────────────────────
          if (entry.action === "Charge modifiée" && before) {
            const { error } = await supabase.from('expenses').update({
              category: before.category, sub_category: before.sub_category,
              detail: before.detail, qty: before.qty, unit_price: before.unit_price,
              paid_by: before.paid_by, included: before.included,
            }).eq('id', before.id);
            if (error) throw new Error("Restauration impossible : " + error.message);

          } else if (entry.action === "Charge supprimée" && before) {
            const { error } = await supabase.from('expenses').insert({
              id: before.id, event_id: before.event_id, category: before.category,
              sub_category: before.sub_category, detail: before.detail, qty: before.qty,
              unit_price: before.unit_price, paid_by: before.paid_by, included: before.included,
              created_by: before.created_by,
            });
            if (error) throw new Error("Impossible de restaurer la charge : " + error.message);

          } else if (entry.action === "Charge ajoutée" && after) {
            const { error } = await supabase.from('expenses').delete().eq('id', after.id);
            if (error) throw new Error("Impossible d'annuler l'ajout : " + error.message);

          // ── Contributions ─────────────────────────────────────
          } else if (entry.action.startsWith("Contribution") && before) {
            const person = before.participant;
            if (person) {
              if (!before.amount || before.amount === 0) {
                await supabase.from('contributions').delete().eq('event_id', entry.event_id).eq('participant', person);
              } else {
                await supabase.from('contributions').upsert({ event_id: entry.event_id, participant: person, amount: before.amount }, { onConflict: 'event_id,participant' });
              }
            }

          // ── Cotisations ───────────────────────────────────────
          } else if (entry.action === "Cotisation ajoutée" && after) {
            const { error } = await supabase.from('cotisations').delete().eq('id', after.id);
            if (error) throw new Error("Impossible d'annuler la cotisation : " + error.message);

          } else if (entry.action === "Cotisation modifiée" && before) {
            const { error } = await supabase.from('cotisations').update({
              montant: before.montant, forme: before.forme,
              statut: before.statut, description: before.description,
            }).eq('id', before.id);
            if (error) throw new Error("Restauration cotisation impossible : " + error.message);

          } else if (entry.action === "Cotisation supprimée" && before) {
            const { error } = await supabase.from('cotisations').insert({
              id: before.id, event_id: before.event_id,
              participant_name: before.participant_name, montant: before.montant,
              forme: before.forme, statut: before.statut, description: before.description,
            });
            if (error) throw new Error("Restauration cotisation impossible : " + error.message);

          // ── Participants ──────────────────────────────────────
          } else if (entry.action === "Participant ajouté" && after) {
            const { error } = await supabase.from('event_participants')
              .delete().eq('event_id', entry.event_id).eq('name', after.name);
            if (error) throw new Error("Impossible d'annuler l'ajout du participant : " + error.message);

          } else if (entry.action === "Participant supprimé" && before) {
            const { error } = await supabase.from('event_participants').insert({
              event_id: entry.event_id, name: before.name,
            });
            if (error) throw new Error("Impossible de restaurer le participant : " + error.message);

          } else {
            addToast(t("hist_no_rollback"), "warning");
            setConfirm(null);
            return;
          }

          await invalidateHistory(entry.id, entry.event_id);
          await reload();
          setConfirm(null);
          addToast(t("hist_rollback_done"), "success");

        } catch (err) {
          setConfirm(null);
          addToast(t("hist_rollback_error") + " " + err.message, "error");
        }
      },
      onCancel: () => setConfirm(null),
    });
  };

  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>{t ? t("hist_title") : "Historique"}</h2>
          <p style={{ color: "#888", fontSize: 12 }}>{t ? t("hist_subtitle") : "Toutes les modifications"}</p>
        </div>
        <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          <option value="all">{t ? t("hist_all_events") : "Tous les événements"}</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="📋" title={t ? t("hist_no_history") : "Aucune modification"} subtitle={t ? t("hist_no_history_desc") : ""} />
      ) : (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #eee", overflow: "hidden" }}>
          {[...filtered].reverse().map((h, i) => {
            const ev = events.find(e => e.id === h.event_id);
            const color = h.invalidated ? "#ddd" : h.action.includes("supprim") ? "#C62828" : h.action.includes("ajout") || h.action.includes("créé") ? "#2E7D32" : "#1565C0";
            return (
              <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", borderBottom: i < filtered.length - 1 ? "1px solid #f5f5f5" : "none", opacity: h.invalidated ? 0.4 : 1, transition: "opacity 0.2s" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {h.action} {h.invalidated && <span style={{ fontSize: 10, color: "#aaa", fontWeight: 400 }}>{t ? t("hist_invalidated_label") : "(invalidé)"}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                    {ev?.name || "–"} · {new Date(h.created_at).toLocaleString("fr-FR")}
                  </div>
                </div>
                {!h.invalidated && ev?.status === "open" && (
                  <button onClick={() => handleRollback(h)} style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" }}>
                    {t ? t("hist_rollback_btn") : "↩ Invalider"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
