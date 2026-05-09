// src/pages/NotificationsPage.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { useTranslation } from "../i18n.jsx";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { updateInvitationPermissions, fetchInvitationPermissions, approvePendingAction, rejectPendingAction } from "../supabase.js";

export function NotificationsPage({ notifications, events, expenses, pendingActions, user, onMarkAll, onDismiss, reload, isMobile, addToast}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(null);
  const [partialPermsModal, setPartialPermsModal] = useState(null); // { action, selectedPerms }

  const handleApprove = async (action) => {
    setSaving(action.id);
    if (action.action_type === "request_permissions") {
      // Ouvrir la modale de sélection partielle
      setPartialPermsModal({
        action,
        selectedPerms: normalizePerms(action.action_data?.requested || []),
      });
      setSaving(null);
      return;
    }
    const { error } = await approvePendingAction(action.id, user.id, {
      action_type: action.action_type,
      action_data: action.action_data,
      event_id: action.event_id,
      guest_email: action.guest_email,
    });
    if (error) {
      addToast((t ? t("notif_approve_error") : "Erreur lors de l'approbation : ") + error.message, "error");
    } else {
      addToast(t ? t("notif_approved") : "Action approuvée et exécutée.", "success");
      // Notifier l'invité via push
      fetch("/api/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestEmail: action.guest_email,
          title: "✅ Demande approuvée",
          body: `Votre demande a été approuvée par l'admin.`,
          url: "/",
        }),
      }).catch(() => {});
    }
    await reload();
    setSaving(null);
  };

  const handleApprovePartialPerms = async () => {
    if (!partialPermsModal) return;
    const { action, selectedPerms } = partialPermsModal;
    setSaving(action.id);
    const existing = await fetchInvitationPermissions(action.event_id, action.guest_email);
    const currentPerms = normalizePerms(existing.data || []);
    const newPerms = [...new Set([...currentPerms, ...selectedPerms])];
    await updateInvitationPermissions(action.event_id, action.guest_email, newPerms);
    // Marquer comme APPROUVÉE (pas rejetée) — sinon l'invité reçoit "refusée"
    await supabase.from('pending_actions')
      .update({ status: 'approved', resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq('id', action.id);
    setPartialPermsModal(null);
    if (selectedPerms.length === 0) {
      addToast(`Aucun droit accordé à ${action.guest_email} — accès lecture seule conservé.`, "info");
    } else {
      const labels = selectedPerms.map(p => ALL_PERMISSIONS[p]?.label || p).join(", ");
      addToast(`Droits accordés à ${action.guest_email} : ${labels}.`, "success");
    }
    await reload();
    setSaving(null);
  };

  const handleReject = async (action) => {
    setSaving(action.id);
    await rejectPendingAction(action.id, user.id);
    await reload();
    setSaving(null);
    addToast(t ? t("notif_rejected") : "Demande refusée.", "info");
  };

  const typeColor = (t) => ({ success: "#2E7D32", warning: "#F57F17", info: "#1565C0", request: "#6A1B9A" }[t] || "#888");
  const typeBg = (t) => ({ success: "#E8F5E9", warning: "#FFF8E1", info: "#E3F2FD", request: "#F3E5F5" }[t] || "#f8f8f8");

  return (
    <div>
      {/* Modal sélection droits partiels */}
      {partialPermsModal && (
        <Modal title="🔐 Accorder des droits" onClose={() => setPartialPermsModal(null)}>
          <div style={{ fontSize: 13, color: "var(--text-sub)", marginBottom: 4 }}>
            <strong>{partialPermsModal.action.guest_email}</strong> demande les droits suivants sur <strong>{partialPermsModal.action.action_data?.event_name || events.find(e => e.id === partialPermsModal.action.event_id)?.name}</strong>.
          </div>
          <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 16 }}>{t ? t("notif_uncheck_rights") : "Décochez les droits que vous ne souhaitez pas accorder."}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {normalizePerms(partialPermsModal.action.action_data?.requested || []).map(p => {
              const info = ALL_PERMISSIONS[p];
              if (!info) return null;
              const checked = partialPermsModal.selectedPerms.includes(p);
              return (
                <label key={p} onClick={() => setPartialPermsModal(prev => ({
                  ...prev,
                  selectedPerms: checked ? prev.selectedPerms.filter(x => x !== p) : [...prev.selectedPerms, p]
                }))} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${checked ? info.color : "var(--border)"}`, background: checked ? info.bg : "var(--bg-secondary)", cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${checked ? info.color : "#ccc"}`, background: checked ? info.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {checked && <span style={{ color: "#fff", fontSize: 11 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 14 }}>{info.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{info.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{info.desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
          {partialPermsModal.selectedPerms.length === 0 && (
            <div style={{ fontSize: 12, color: "#F57F17", background: "#FFF8E1", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
              ⚠️ Aucun droit sélectionné — l'invité restera en lecture seule.
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleApprovePartialPerms} disabled={saving === partialPermsModal.action.id}
              style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", background: "#2E7D32" }}>
              {saving === partialPermsModal.action.id ? "..." : `✓ Accorder ${partialPermsModal.selectedPerms.length > 0 ? `(${partialPermsModal.selectedPerms.length} droit${partialPermsModal.selectedPerms.length > 1 ? "s" : ""})` : ""}`}
            </button>
            <button onClick={() => { handleReject(partialPermsModal.action); setPartialPermsModal(null); }}
              style={{ padding: "10px 16px", borderRadius: 10, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 13, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
              ✗ Refuser tout
            </button>
          </div>
        </Modal>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2 }}>{t ? t("notif_title") : "Notifications"}</h2>
          <p style={{ color: "#888", fontSize: 12 }}>{notifications.filter(n => !n.is_read).length} non lue(s) · {pendingActions.length} demande(s)</p>
        </div>
        <button onClick={onMarkAll} style={S.btnGhost}>{t ? t("notif_mark_all") : "Tout marquer lu"}</button>
      </div>

      {pendingActions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6A1B9A", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 12 }}>
            {t ? `⏳ ${t("notif_pending")} (${pendingActions.length})` : `⏳ Demandes en attente (${pendingActions.length})`}
          </div>
          {pendingActions.map(action => {
            const ev = events.find(e => e.id === action.event_id);
            const data = action.action_data;
            const isPermRequest = action.action_type === "request_permissions";

            if (isPermRequest) {
              return (
                <div key={action.id} style={{ background: "#FFF8E1", borderRadius: 14, padding: "16px 18px", border: "1.5px solid #FFE082", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 24, flexShrink: 0 }}>🔐</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#F57F17", marginBottom: 6 }}>
                        {action.guest_email} demande des droits sur "{data?.event_name || ev?.name}"
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                        {(data?.requested || []).map(p => {
                          const pInfo = ALL_PERMISSIONS[p];
                          return pInfo ? (
                            <span key={p} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: pInfo.bg, color: pInfo.color, fontWeight: 700 }}>
                              {pInfo.icon} {pInfo.label}
                            </span>
                          ) : null;
                        })}
                      </div>
                      <div style={{ fontSize: 10, color: "#aaa" }}>{new Date(action.created_at).toLocaleString("fr-FR")}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => handleApprove(action)} disabled={saving === action.id}
                      style={{ ...S.btnDark, background: "#2E7D32", padding: "7px 16px", fontSize: 12, flex: 1, justifyContent: "center", display: "flex" }}>
                      {saving === action.id ? "..." : "🔐 Gérer les droits →"}
                    </button>
                    <button onClick={() => handleReject(action)} disabled={saving === action.id}
                      style={{ padding: "7px 16px", borderRadius: 9, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 12, cursor: "pointer", fontWeight: 700, flex: 1, fontFamily: "inherit" }}>
                      ✗ Refuser
                    </button>
                  </div>
                </div>
              );
            }

            const total = ((data?.qty || 0) * (data?.unit || 0)).toFixed(2);
            const isModify = action.action_type === "modify_expense";
            const originalExp = expenses.find(e => e.id === data?.expense_id);
            return (
              <div key={action.id} style={{ background: isModify ? "#FFF3E0" : "#F3E5F5", borderRadius: 14, padding: "16px 18px", border: `1.5px solid ${isModify ? "#FFCC80" : "#ce93d8"}`, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 24, flexShrink: 0 }}>{isModify ? "✏️" : "📝"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isModify ? "#E65100" : "#6A1B9A", marginBottom: 6 }}>
                      {action.guest_email} {isModify ? "demande de modifier une charge" : "demande d'ajouter une charge"}
                    </div>
                    {isModify && originalExp && (
                      <div style={{ fontSize: 12, color: "#888", marginBottom: 4, fontStyle: "italic" }}>
                        Original : <strong>{originalExp.detail}</strong> → <strong>{data?.detail}</strong>
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>
                      <strong>{ev?.name}</strong> · {data?.detail} · <strong>{total} {currencySymbol(ev?.currency)}</strong>
                    </div>
                    <div style={{ fontSize: 11, color: "#888" }}>
                      Payé par : {data?.paidBy} · Inclus : {(data?.included || []).join(", ")}
                    </div>
                    {data?.comment && (
                      <div style={{ fontSize: 11, color: "#666", fontStyle: "italic", marginTop: 4 }}>💬 {data.comment}</div>
                    )}
                    <div style={{ fontSize: 10, color: "#aaa", marginTop: 4 }}>
                      {new Date(action.created_at).toLocaleString("fr-FR")}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleApprove(action)} disabled={saving === action.id}
                    style={{ ...S.btnDark, background: "#2E7D32", padding: "7px 16px", fontSize: 12, flex: 1, justifyContent: "center", display: "flex" }}>
                    {saving === action.id ? "..." : "✓ Approuver"}
                  </button>
                  <button onClick={() => handleReject(action)} disabled={saving === action.id}
                    style={{ padding: "7px 16px", borderRadius: 10, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 12, cursor: "pointer", fontWeight: 700, flex: 1 }}>
                    ✕ Refuser
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {notifications.length === 0 && pendingActions.length === 0 ? (
        <EmptyState icon="🔔" title="Aucune notification" subtitle="Vous êtes à jour ! Les notifications apparaîtront ici." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {notifications.map(n => {
            const ev = events.find(e => e.id === n.event_id);
            return (
              <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "13px 16px", borderRadius: 14, background: n.is_read ? "#fafafa" : typeBg(n.type), border: `1px solid ${n.is_read ? "#eee" : typeColor(n.type) + "44"}`, transition: "all 0.15s" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: n.is_read ? "#e0e0e0" : typeColor(n.type), marginTop: 4, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: n.is_read ? "#999" : "#333", lineHeight: 1.4 }}>{n.message}</div>
                  {ev && <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>{ev.name} · {new Date(n.created_at).toLocaleString("fr-FR")}</div>}
                </div>
                <button onClick={() => onDismiss(n.id)} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 18, padding: 0, flexShrink: 0, lineHeight: 1 }}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
