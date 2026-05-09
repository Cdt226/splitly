// src/pages/Invite.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { useTranslation } from "../i18n.jsx";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { sendInvitation, removeInvitation, updateInvitationRole, updateInvitationPermissions, fetchInvitationPermissions, requestPermissions, fetchInvitations } from "../supabase.js";

const ALL_PERMISSIONS = {
  add_expense:         { label: t ? t("inv_perm_add") : "Ajouter charge",          icon: "➕",  desc: "Créer de nouvelles charges", color: "#1565C0", bg: "#E3F2FD", split: true, budget: true },
  edit_expense:        { label: t ? t("inv_perm_edit") : "Modifier charge",         icon: "✏️",  desc: "Modifier les charges existantes", color: "#F57F17", bg: "#FFF8E1", split: true, budget: true },
  delete_expense:      { label: t ? t("inv_perm_delete") : "Supprimer charge",        icon: "🗑",  desc: "Supprimer des charges", color: "#C62828", bg: "#FFEBEE", split: true, budget: true },
  add_participant:     { label: t ? t("inv_perm_add_part") : "Ajouter participant",     icon: "👤+", desc: "Ajouter des participants", color: "#2E7D32", bg: "#E8F5E9", split: true, budget: true },
  remove_participant:  { label: t ? t("inv_perm_delete_part") : "Supprimer participant",   icon: "👤-", desc: "Retirer des participants", color: "#C62828", bg: "#FFEBEE", split: true, budget: true },
  add_cotisation:      { label: "Ajouter cotisation",      icon: "💰+", desc: "Créer des cotisations", color: "#6A1B9A", bg: "#F3E5F5", split: false, budget: true },
  edit_cotisation:     { label: "Modifier cotisation",     icon: "💰✏", desc: "Modifier les cotisations", color: "#6A1B9A", bg: "#F3E5F5", split: false, budget: true },
  export_pdf:          { label: t ? t("inv_perm_pdf") : "Exporter PDF",            icon: "📄",  desc: "Générer des PDF", color: "#0F0F0F", bg: "#f0f0f0", split: true, budget: true },
};

// Retourne les permissions disponibles pour un type d'événement (jamais read_only)
function getAvailablePermissions(eventType) {
  return Object.entries(ALL_PERMISSIONS)
    .filter(([, p]) => eventType === "budget" ? p.budget : p.split)
    .map(([key, p]) => ({ key, ...p }));
}

// Vérifie si un invité a une permission spécifique
// Un tableau vide ou null = lecture seule (aucun droit supplémentaire)
function hasPermission(permissions, perm) {
  if (!permissions || permissions.length === 0) return false;
  // Compatibilité ascendante : ancienne valeur "read_only" = aucun droit
  const filtered = permissions.filter(p => p !== "read_only");
  return filtered.includes(perm);
}

// Normalise les permissions : retire read_only, déduplique
function normalizePerms(perms) {
  if (!perms) return [];
  return [...new Set(perms.filter(p => p !== "read_only"))];
}

// Badge lecture seule ou droits actifs
export function PermissionSummaryBadge({ permissions }) {
  const perms = normalizePerms(permissions);
  if (perms.length === 0) {
    return <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "#f5f5f5", color: "#888", fontWeight: 700 }}>👁 Lecture seule</span>;
  }
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {perms.map(p => {
        const info = ALL_PERMISSIONS[p];
        return info ? (
          <span key={p} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: info.bg, color: info.color, fontWeight: 700 }}>
            {info.icon} {info.label}
          </span>
        ) : null;
      })}
    </div>
  );
}

// ─── INVITE ───────────────────────────────────────────────────
export function Invite({ events, user, isMobile, addToast}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [saving, setSaving] = useState(false);

  // Gestionnaire de droits refonte
  const [managerEmail, setManagerEmail] = useState(null); // email géré
  const [managerMode, setManagerMode] = useState("by_event"); // "by_event" | "selection" | "all"
  const [managerPerms, setManagerPerms] = useState({}); // { eventId: [perms] }
  const [selectionPerms, setSelectionPerms] = useState([]); // perms communes pour "selection"
  const [selectionEvents, setSelectionEvents] = useState([]); // events sélectionnés pour "selection"
  const [allPerms, setAllPerms] = useState([]); // perms pour "all"
  const [confirmAll, setConfirmAll] = useState(false); // visa fort pour "all"
  const [savingPerms, setSavingPerms] = useState(false);

  const loadInvites = async () => {
    const all = [];
    for (const ev of events) {
      const { data } = await fetchInvitations(ev.id);
      if (data) all.push(...data.map(i => ({ ...i, eventName: ev.name, eventType: ev.event_type })));
    }
    setInvitations(all);
  };

  useEffect(() => { if (events.length > 0) loadInvites(); }, [events]);

  // Invitations groupées par email
  const invitationsByEmail = invitations.reduce((acc, inv) => {
    if (!acc[inv.email]) acc[inv.email] = [];
    acc[inv.email].push(inv);
    return acc;
  }, {});

  const handleSend = async () => {
    if (!email) { addToast(t ? t("inv_email_required") : "Entrez un email.", "warning"); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { addToast(t ? t("toast_invalid_email") : "Format d'email invalide.", "warning"); return; }
    if (email.trim().toLowerCase() === user?.email?.toLowerCase()) {
      addToast(t ? t("inv_self_invite") : "Vous ne pouvez pas vous inviter vous-même.", "warning"); return;
    }
    if (selectedEvents.length === 0) { addToast(t ? t("toast_select_event") : "Sélectionnez au moins un événement.", "warning"); return; }
    setSaving(true);
    const finalPerms = normalizePerms(permissions);

    // Vérifier doublons — si TOUS les événements ont déjà cet invité → ouvrir droits
    const existing = invitations.filter(i => i.email === email && selectedEvents.includes(i.event_id));
    if (existing.length > 0 && existing.length === selectedEvents.length) {
      setSaving(false);
      addToast(`${email} est déjà invité sur ces événements. Modifiez ses droits.`, "info");
      openManager(email);
      return;
    }

    const newlyInvitedEventNames = [];
    for (const evId of selectedEvents) {
      const alreadyExists = invitations.find(i => i.email === email && i.event_id === evId);
      if (!alreadyExists) {
        const ev = events.find(e => e.id === evId);
        const compatiblePerms = finalPerms.filter(p => {
          const pInfo = ALL_PERMISSIONS[p];
          if (!pInfo) return false;
          return ev?.event_type === "budget" ? pInfo.budget : pInfo.split;
        });
        await sendInvitation({ eventId: evId, email, role: compatiblePerms.length > 0 ? "edit" : "read", invitedBy: user.id, permissions: compatiblePerms });
        if (ev) newlyInvitedEventNames.push(`${ev.event_type === "budget" ? "🏦" : "💸"} ${ev.name}`);
      }
    }

    // Envoyer l'email d'invitation avec le lien d'accès direct
    if (newlyInvitedEventNames.length > 0) {
      try {
        const adminName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Un utilisateur";
        await fetch("/api/send-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: email,
            guestEmail: email,
            adminName,
            eventNames: newlyInvitedEventNames,
            appUrl: window.location.origin,
          }),
        });
      } catch {} // L'invitation en base est créée même si l'email échoue
    }

    setEmail(""); setSelectedEvents([]); setPermissions([]);
    await loadInvites();
    setSaving(false);
    addToast(`✉️ ${t ? t("inv_sent") : "Invitation envoyée à"} ${email}.`, "success");
  };

  const handleRemove = async (inv) => {
    await removeInvitation(inv.event_id, inv.email);
    await loadInvites();
    addToast(t ? t("inv_removed") : "Accès retiré.", "info");
  };

  // Ouvrir le gestionnaire de droits pour un email
  const openManager = (guestEmail) => {
    const guestInvs = invitations.filter(i => i.email === guestEmail);
    // Construire la map initiale de perms par event
    const pMap = {};
    guestInvs.forEach(i => { pMap[i.event_id] = normalizePerms(i.permissions); });
    setManagerEmail(guestEmail);
    setManagerMode("by_event");
    setManagerPerms(pMap);
    setSelectionPerms([]);
    setSelectionEvents([]);
    setAllPerms([]);
    setConfirmAll(false);
  };

  const closeManager = () => {
    setManagerEmail(null);
    setConfirmAll(false);
  };

  const handleSaveManager = async () => {
    if (!managerEmail) return;
    setSavingPerms(true);
    const guestInvs = invitations.filter(i => i.email === managerEmail);
    try {
      if (managerMode === "by_event") {
        // Enregistrer chaque événement individuellement
        for (const inv of guestInvs) {
          const perms = managerPerms[inv.event_id] || [];
          await updateInvitationPermissions(inv.event_id, managerEmail, perms, false);
        }
        addToast(`${t ? t("inv_rights_updated") : "Droits mis à jour pour"} ${managerEmail}.`, "success");
      } else if (managerMode === "selection") {
        for (const evId of selectionEvents) {
          await updateInvitationPermissions(evId, managerEmail, selectionPerms, false);
        }
        addToast(`Droits appliqués sur ${selectionEvents.length} événement(s).`, "success");
      } else if (managerMode === "all") {
        if (!confirmAll) { addToast("Cochez la confirmation pour appliquer à tous les événements.", "warning"); setSavingPerms(false); return; }
        // Appliquer à tous (actuels + futurs via applyToAll=true)
        await updateInvitationPermissions(guestInvs[0]?.event_id, managerEmail, allPerms, true);
        addToast(`Droits appliqués à TOUS les événements (actuels et futurs) pour ${managerEmail}.`, "success");
      }
      await loadInvites();
      closeManager();
    } catch (e) { addToast((t ? t("ev_error") : "Erreur : ") + e.message, "error"); }
    setSavingPerms(false);
  };

  const togglePerm = (perms, setPerms, key) => {
    setPerms(perms.includes(key) ? perms.filter(p => p !== key) : [...perms, key]);
  };

  const PermBadge = ({ perm }) => {
    if (perm === "read_only") return <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#f5f5f5", color: "#888", fontWeight: 700 }}>👁 Lecture seule</span>;
    const p = ALL_PERMISSIONS[perm];
    if (!p) return null;
    return <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: p.bg, color: p.color, fontWeight: 700, border: `1px solid ${p.color}22`, whiteSpace: "nowrap" }}>{p.icon} {p.label}</span>;
  };

  // Composant checkboxes de permissions réutilisable
  const PermCheckboxes = ({ eventType, perms, onToggle }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {getAvailablePermissions(eventType || "split").map(p => (
        <label key={p.key} onClick={() => onToggle(p.key)}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 9, border: `1.5px solid ${perms.includes(p.key) ? p.color : "var(--border)"}`, background: perms.includes(p.key) ? p.bg : "var(--bg-secondary)", cursor: "pointer", transition: "all 0.15s" }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${perms.includes(p.key) ? p.color : "#ccc"}`, background: perms.includes(p.key) ? p.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {perms.includes(p.key) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
          </div>
          <span style={{ fontSize: 12 }}>{p.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{p.label}</div>
            <div style={{ fontSize: 10, color: "var(--text-sub)" }}>{p.desc}</div>
          </div>
        </label>
      ))}
      {perms.length === 0 && <div style={{ fontSize: 11, color: "#888", background: "#f5f5f5", borderRadius: 8, padding: "6px 12px" }}>👁 Aucun droit = Lecture seule</div>}
    </div>
  );

  // Invités gérés (emails uniques)
  const uniqueEmails = Object.keys(invitationsByEmail);
  // Événements de l'invité géré (pour les modes selection/all)
  const managerInvs = managerEmail ? invitations.filter(i => i.email === managerEmail) : [];

  return (
    <div>
      {/* ─── Modal Gestionnaire de droits ─── */}
      {managerEmail && (
        <Modal title={`🔐 Droits de ${managerEmail}`} onClose={closeManager}>
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            {/* Sélecteur de mode */}
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Mode d'application</label>
              <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 10, padding: 3, gap: 2, marginTop: 6 }}>
                {[
                  { key: "by_event", label: "Par événement" },
                  { key: "selection", label: "Sélection" },
                  { key: "all", label: "⚠️ Tous" },
                ].map(m => (
                  <button key={m.key} onClick={() => { setManagerMode(m.key); setConfirmAll(false); }}
                    style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "none", background: managerMode === m.key ? (m.key === "all" ? "#C62828" : "#0F0F0F") : "transparent", color: managerMode === m.key ? "#fff" : "var(--text-muted)", fontSize: 11, fontWeight: managerMode === m.key ? 700 : 400, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", transition: "all 0.15s" }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode PAR ÉVÉNEMENT */}
            {managerMode === "by_event" && (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 12 }}>Définissez des droits différents pour chaque événement.</div>
                {managerInvs.map(inv => (
                  <div key={inv.event_id} style={{ marginBottom: 16, background: "var(--hover-bg)", borderRadius: 12, padding: "12px 14px", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span>{inv.eventType === "budget" ? "🏦" : "💸"}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{inv.eventName}</span>
                    </div>
                    <PermCheckboxes
                      eventType={inv.eventType}
                      perms={managerPerms[inv.event_id] || []}
                      onToggle={(key) => setManagerPerms(prev => {
                        const cur = prev[inv.event_id] || [];
                        return { ...prev, [inv.event_id]: cur.includes(key) ? cur.filter(p => p !== key) : [...cur, key] };
                      })}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Mode SÉLECTION */}
            {managerMode === "selection" && (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 12 }}>Sélectionnez les événements et appliquez les mêmes droits.</div>
                {/* Choix événements */}
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Événements concernés</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                    {managerInvs.map(inv => (
                      <label key={inv.event_id} onClick={() => setSelectionEvents(prev => prev.includes(inv.event_id) ? prev.filter(x => x !== inv.event_id) : [...prev, inv.event_id])}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 9, border: `1.5px solid ${selectionEvents.includes(inv.event_id) ? "#1565C0" : "var(--border)"}`, background: selectionEvents.includes(inv.event_id) ? "#E3F2FD" : "var(--hover-bg)", cursor: "pointer", transition: "all 0.15s" }}>
                        <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${selectionEvents.includes(inv.event_id) ? "#1565C0" : "#ccc"}`, background: selectionEvents.includes(inv.event_id) ? "#1565C0" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {selectionEvents.includes(inv.event_id) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                        </div>
                        <span>{inv.eventType === "budget" ? "🏦" : "💸"}</span>
                        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: selectionEvents.includes(inv.event_id) ? 700 : 400 }}>{inv.eventName}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {/* Droits à appliquer */}
                {selectionEvents.length > 0 && (
                  <div>
                    <label style={{ ...S.label, marginBottom: 8 }}>Droits à appliquer</label>
                    <PermCheckboxes
                      eventType={managerInvs.find(i => selectionEvents.includes(i.event_id))?.eventType}
                      perms={selectionPerms}
                      onToggle={(key) => togglePerm(selectionPerms, setSelectionPerms, key)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Mode TOUS */}
            {managerMode === "all" && (
              <div>
                <div style={{ background: "#FFEBEE", border: "1px solid #FFCDD2", borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: 12, color: "#C62828" }}>
                  ⚠️ <strong>Attention :</strong> Ces droits s'appliqueront à <strong>TOUS les événements actuels ET futurs</strong> créés par vous auxquels cet invité sera invité.
                </div>
                <PermCheckboxes
                  eventType="split"
                  perms={allPerms}
                  onToggle={(key) => togglePerm(allPerms, setAllPerms, key)}
                />
                {/* Visa fort */}
                <label onClick={() => setConfirmAll(!confirmAll)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: confirmAll ? "#FFEBEE" : "var(--hover-bg)", border: `1.5px solid ${confirmAll ? "#C62828" : "var(--border)"}`, cursor: "pointer", marginTop: 14, transition: "all 0.15s" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${confirmAll ? "#C62828" : "#ccc"}`, background: confirmAll ? "#C62828" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {confirmAll && <span style={{ color: "#fff", fontSize: 11 }}>✓</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: confirmAll ? "#C62828" : "var(--text)" }}>Je confirme appliquer ces droits à tous mes événements</div>
                    <div style={{ fontSize: 11, color: "var(--text-sub)" }}>Cette action affecte les événements existants et futurs</div>
                  </div>
                </label>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={handleSaveManager} disabled={savingPerms || (managerMode === "all" && !confirmAll) || (managerMode === "selection" && selectionEvents.length === 0)}
              style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", background: managerMode === "all" ? "#C62828" : undefined, opacity: (managerMode === "all" && !confirmAll) || (managerMode === "selection" && selectionEvents.length === 0) ? 0.5 : 1 }}>
              {savingPerms ? "..." : "✓ Enregistrer"}
            </button>
            <button onClick={closeManager} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>{t ? t("cancel") : "Annuler"}</button>
          </div>
        </Modal>
      )}

      <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>Invitations</h2>
      <p style={{ color: "var(--text-sub)", fontSize: 12, marginBottom: 20 }}>Gérez l'accès et les droits de vos invités</p>

      {/* ─── Formulaire invitation ─── */}
      <div style={S.card}>
        <div style={S.sectionTitle}>✉️ Inviter quelqu'un</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={S.label}>Email de l'invité <span style={{ color: "#C62828" }}>*</span></label>
            <input style={{ ...S.input, borderColor: email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "#C62828" : email ? "#4CAF50" : undefined, transition: "border-color 0.2s" }}
              type="email" placeholder="ami@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            {email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (
              <div style={{ fontSize: 11, color: "#C62828", marginTop: 4 }}>⚠️ Format d'email invalide</div>
            )}
          </div>
        </div>

        {/* Permissions — filtrées selon le type des événements sélectionnés */}
        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>{t ? t("inv_rights_granted") : "Droits accordés"} <span style={{ color: "var(--text-sub)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t ? `(${t("inv_read_only_default")})` : "(lecture seule par défaut)"}</span></label>
          {(() => {
            const selectedEvObjects = events.filter(e => selectedEvents.includes(e.id));
            const hasSplit = selectedEvObjects.some(e => e.event_type !== "budget");
            const hasBudget = selectedEvObjects.some(e => e.event_type === "budget");
            const hasMixed = hasSplit && hasBudget;
            // Filtrer : si mix → droits communs aux deux types. Si split seul → split. Si budget seul → budget
            const availablePerms = Object.entries(ALL_PERMISSIONS).filter(([, p]) => {
              if (hasMixed) return p.split && p.budget;
              if (hasBudget) return p.budget;
              return p.split; // split seul ou aucun sélectionné
            });
            return (
              <>
                {hasMixed && (
                  <div style={{ background: "#E3F2FD", border: "1px solid #BBDEFB", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#1565C0", marginBottom: 10, marginTop: 6 }}>
                    ℹ️ Événements Split et Budget mélangés — seuls les droits communs sont disponibles. Les droits spécifiques Budget (cotisations) doivent être accordés séparément.
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
                  {availablePerms.map(([key, p]) => (
                    <label key={key} onClick={() => togglePerm(permissions, setPermissions, key)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${permissions.includes(key) ? p.color : "var(--border)"}`, background: permissions.includes(key) ? p.bg : "var(--bg-secondary)", cursor: "pointer", transition: "all 0.15s" }}>
                      <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${permissions.includes(key) ? p.color : "#ccc"}`, background: permissions.includes(key) ? p.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {permissions.includes(key) && <span style={{ color: "#fff", fontSize: 10 }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 11 }}>{p.icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", flex: 1 }}>{p.label}</span>
                    </label>
                  ))}
                </div>
                {permissions.length === 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#888", background: "#f5f5f5", borderRadius: 8, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    👁 Aucun droit sélectionné = <strong>{t ? t("inv_read") : "Lecture seule"}</strong>
                  </div>
                )}
                {selectedEvents.length === 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#aaa", background: "#f9f9f9", borderRadius: 8, padding: "6px 12px" }}>
                    Sélectionnez d'abord un événement pour voir les droits disponibles.
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Événements */}
        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Événements accessibles</label>
          {events.length === 0 ? <div style={{ color: "#aaa", fontSize: 13, padding: "8px 0" }}>Aucun événement créé</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {events.map(ev => (
                <label key={ev.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, padding: "8px 12px", borderRadius: 10, background: selectedEvents.includes(ev.id) ? "#f0faf4" : "var(--hover-bg)", border: `1px solid ${selectedEvents.includes(ev.id) ? "#c8e6c9" : "var(--border)"}`, transition: "all 0.15s" }}>
                  <input type="checkbox" checked={selectedEvents.includes(ev.id)} onChange={() => setSelectedEvents(s => s.includes(ev.id) ? s.filter(x => x !== ev.id) : [...s, ev.id])} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}
                  </span>
                  <span style={{ color: "var(--text-sub)", fontSize: 11, flexShrink: 0 }}>{ev.date}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <button onClick={handleSend} disabled={saving} style={S.btnDark}>{saving ? "Envoi..." : "Envoyer l'invitation ✉️"}</button>
      </div>

      {/* ─── Liste invités groupés par email ─── */}
      <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", marginTop: 16 }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
          Invités ({uniqueEmails.length} personne{uniqueEmails.length > 1 ? "s" : ""} · {invitations.length} invitation{invitations.length > 1 ? "s" : ""})
        </div>
        {uniqueEmails.length === 0 ? (
          <EmptyState icon="👥" title="Aucun invité" subtitle="Invitez des personnes à consulter vos événements." />
        ) : uniqueEmails.map((guestEmail, gi) => {
          const guestInvs = invitationsByEmail[guestEmail];
          const allAccepted = guestInvs.every(i => i.status === "accepted");
          return (
            <div key={guestEmail} style={{ borderBottom: gi < uniqueEmails.length - 1 ? "1px solid var(--border)" : "none" }}>
              {/* En-tête invité */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", flexWrap: "wrap" }}>
                <Avatar name={guestEmail[0]} size={34} />
                <div style={{ flex: 1, minWidth: 100 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{guestEmail}</div>
                  <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 1 }}>{guestInvs.length} événement{guestInvs.length > 1 ? "s" : ""}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: allAccepted ? "#E8F5E9" : "#FFF8E1", color: allAccepted ? "#2E7D32" : "#F57F17", flexShrink: 0 }}>
                  {allAccepted ? "✓ Accepté" : "⏳ En attente"}
                </span>
                <button onClick={() => openManager(guestEmail)}
                  style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 11, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>
                  {t ? "🔐 " + t("inv_manage_rights") : "🔐 Gérer les droits"}
                </button>
                <button onClick={() => { if (window.confirm(`Retirer ${guestEmail} de tous les événements ?`)) guestInvs.forEach(i => handleRemove(i)); }}
                  style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #ffcdd2", background: "#fff5f5", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>
                  Retirer
                </button>
              </div>
              {/* Détail par événement */}
              <div style={{ paddingLeft: isMobile ? 16 : 64, paddingRight: 18, paddingBottom: 12 }}>
                {guestInvs.map(inv => (
                  <div key={inv.event_id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "var(--text-sub)" }}>{inv.eventType === "budget" ? "🏦" : "💸"} <Truncate text={inv.eventName} max={20} /></span>
                    <span style={{ fontSize: 9, color: "#aaa" }}>·</span>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {normalizePerms(inv.permissions).length === 0
                        ? <PermBadge perm="read_only" />
                        : normalizePerms(inv.permissions).map(p => <PermBadge key={p} perm={p} />)
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
