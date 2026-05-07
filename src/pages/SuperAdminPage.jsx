// src/pages/SuperAdminPage.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { fetchAdminUsers, adminUserAction, fetchReports, createReport, fetchCotisations } from "../supabase.js";

export function SuperAdminPage({ user, isMobile, addToast }) {
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "users" | "reports"
  const [confirm, setConfirm] = useState(null);
  const [emailModal, setEmailModal] = useState(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [acting, setActing] = useState(null);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [updatingReport, setUpdatingReport] = useState(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await fetchAdminUsers();
    if (error) {
      const isTokenError = error.message?.toLowerCase().includes("token") || error.message?.toLowerCase().includes("jwt") || error.message?.toLowerCase().includes("unauthorized");
      addToast(isTokenError ? "Session expirée — veuillez vous reconnecter." : "Erreur chargement : " + error.message, isTokenError ? "warning" : "error");
    } else setUsers(data || []);
    // Load reports via supabase directly (service key not needed for reads with RLS bypassed via admin)
    try {
      const { data: rData } = await fetchReports();
      setReports(rData || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ── Métriques ─────────────────────────────────────────────
  const now = new Date();
  const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const newThisWeek = users.filter(u => new Date(u.created_at) > oneWeekAgo).length;
  const newThisMonth = users.filter(u => new Date(u.created_at) > oneMonthAgo).length;
  const activeUsers = users.filter(u => u.user_role === "user").length;
  const blockedUsers = users.filter(u => u.user_role === "blocked").length;
  const activated = users.filter(u => u.events_total > 0).length;
  const activationRate = users.length > 0 ? ((activated / users.length) * 100).toFixed(0) : 0;
  const totalEvents = users.reduce((s, u) => s + (u.events_total || 0), 0);
  const totalBudget = users.reduce((s, u) => s + (u.budget_total || 0), 0);
  const avgEvents = users.length > 0 ? (totalEvents / users.length).toFixed(1) : 0;
  const openReports = reports.filter(r => r.status === "open").length;

  const ADMIN_TABS = [
    { key: "overview",  icon: "📊", label: "Vue d'ensemble" },
    { key: "users",     icon: "👥", label: "Utilisateurs" },
    { key: "reports",   icon: "🚨", label: `Signalements${openReports > 0 ? ` (${openReports})` : ""}` },
  ];

  const reportCategoryLabel = {
    bug: "🐛 Bug technique",
    data: "📊 Données",
    access: "🔐 Accès",
    request: "💡 Demande",
    other: "💬 Autre",
  };

  const handleUpdateReportStatus = async (reportId, status) => {
    setUpdatingReport(reportId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'update_report', userId: user.id, reportId, status }),
      });
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status } : r));
      addToast(`Signalement marqué "${status}".`, "success");
    } catch { addToast("Erreur de mise à jour.", "error"); }
    setUpdatingReport(null);
  };

  const handleAction = async () => {
    if (!confirm) return;
    setActing(confirm.userId);
    const { error } = await adminUserAction(confirm.action, confirm.userId);
    if (error) addToast("Erreur : " + error.message, "error");
    else {
      const labels = { block: "bloqué", unblock: "débloqué", delete: "supprimé" };
      addToast(`✓ Compte ${labels[confirm.action]} avec succès.`, "success");
      await load();
    }
    setActing(null);
    setConfirm(null);
  };

  const handleSendEmail = async () => {
    if (!emailModal || !emailSubject.trim() || !emailBody.trim()) return;
    setSendingEmail(true);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emailModal.userEmail,
          subject: emailSubject,
          html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;padding:32px">
            <h2 style="color:#0F0F0F">Message de l'équipe SplitLy</h2>
            <div style="font-size:15px;line-height:1.7;color:#333;white-space:pre-wrap">${emailBody}</div>
            <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
            <p style="font-size:12px;color:#aaa">Cet email a été envoyé depuis le back-office SplitLy.</p>
          </div>`,
        }),
      });
      if (res.ok) {
        addToast(`✉️ Email envoyé à ${emailModal.userEmail}`, "success");
        setEmailModal(null);
        setEmailSubject("");
        setEmailBody("");
      } else {
        addToast("Erreur lors de l'envoi de l'email.", "error");
      }
    } catch {
      addToast("Erreur réseau.", "error");
    }
    setSendingEmail(false);
  };

  // Filtres
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.email?.toLowerCase().includes(q) || u.full_name?.toLowerCase().includes(q);
    const matchRole = filterRole === "all" || u.user_role === filterRole;
    return matchSearch && matchRole;
  });

  const roleBadge = (role) => {
    const map = {
      admin:   { label: "Admin",   bg: "#FFF8E1", color: "#F57F17" },
      user:    { label: "Utilisateur", bg: "#E8F5E9", color: "#2E7D32" },
      blocked: { label: "Bloqué",  bg: "#FFEBEE", color: "#C62828" },
    };
    const s = map[role] || map.user;
    return <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20, border: `1px solid ${s.color}22` }}>{s.label}</span>;
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const fmtDateShort = (d) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";

  return (
    <div>
      {emailModal && (
        <Modal title={`✉️ Envoyer un email à ${emailModal.userName}`} onClose={() => { setEmailModal(null); setEmailSubject(""); setEmailBody(""); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.8, display: "block", marginBottom: 6 }}>Destinataire</label>
              <div style={{ fontSize: 13, color: "var(--text)", padding: "8px 12px", background: "var(--hover-bg)", borderRadius: 8, border: "1px solid var(--border)" }}>{emailModal.userEmail}</div>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.8, display: "block", marginBottom: 6 }}>Sujet</label>
              <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
                placeholder="Objet de l'email..."
                style={{ ...S.input, width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.8, display: "block", marginBottom: 6 }}>Message</label>
              <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)}
                placeholder="Votre message..."
                rows={6}
                style={{ ...S.input, width: "100%", resize: "vertical", minHeight: 120 }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSendEmail} disabled={sendingEmail || !emailSubject.trim() || !emailBody.trim()}
                style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", opacity: (!emailSubject.trim() || !emailBody.trim()) ? 0.5 : 1 }}>
                {sendingEmail ? "Envoi..." : "✉️ Envoyer"}
              </button>
              <button onClick={() => { setEmailModal(null); setEmailSubject(""); setEmailBody(""); }}
                style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
            </div>
          </div>
        </Modal>
      )}

      {confirm && (
        <Modal title="Confirmer l'action" onClose={() => setConfirm(null)}>
          <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 16, lineHeight: 1.6 }}>
            {confirm.action === "delete" && (
              <>
                <div style={{ background: "#FFEBEE", border: "1px solid #FFCDD2", borderRadius: 10, padding: "12px 16px", marginBottom: 14, fontSize: 13, color: "#C62828" }}>
                  ⚠️ Cette action est <strong>irréversible</strong>. Tous les événements, charges et données de cet utilisateur seront supprimés définitivement.
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#C62828", display: "block", marginBottom: 6 }}>
                    Tapez <strong>SUPPRIMER</strong> pour confirmer
                  </label>
                  <input style={{ ...S.input, borderColor: "#ffcdd2" }}
                    placeholder="SUPPRIMER"
                    value={confirm.deleteConfirm || ""}
                    onChange={e => setConfirm({ ...confirm, deleteConfirm: e.target.value })} />
                </div>
              </>
            )}
            <span>Action : <strong>{confirm.action === "block" ? "Bloquer" : confirm.action === "unblock" ? "Débloquer" : "Supprimer"}</strong> le compte de <strong>{confirm.userName}</strong></span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleAction}
              disabled={!!acting || (confirm.action === "delete" && confirm.deleteConfirm !== "SUPPRIMER")}
              style={{ ...S.btnDark, flex: 1, justifyContent: "center", display: "flex", background: confirm.action === "delete" ? "#C62828" : confirm.action === "block" ? "#F57F17" : "#2E7D32", opacity: (confirm.action === "delete" && confirm.deleteConfirm !== "SUPPRIMER") ? 0.5 : 1 }}>
              {acting ? "..." : "Confirmer"}
            </button>
            <button onClick={() => setConfirm(null)} style={{ ...S.btnGhost, flex: 1, justifyContent: "center", display: "flex" }}>Annuler</button>
          </div>
        </Modal>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 4, color: "var(--text)", display: "flex", alignItems: "center", gap: 10 }}>
            ⚡ Super Admin
            <span style={{ background: "#FFF8E1", color: "#F57F17", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, border: "1px solid #FFE08244" }}>Back-office</span>
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>Administration SplitLy</p>
        </div>
        <button onClick={load} style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }}>↻ Actualiser</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 12, padding: 3, gap: 2, marginBottom: 24, flexWrap: "wrap" }}>
        {ADMIN_TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 9, border: "none", background: activeTab === tab.key ? "#0F0F0F" : "transparent", color: activeTab === tab.key ? "#fff" : "var(--text-muted)", fontSize: 12, fontWeight: activeTab === tab.key ? 700 : 400, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* ── VUE D'ENSEMBLE ── */}
      {activeTab === "overview" && (
        <div>
          {/* KPIs globaux */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Utilisateurs total", value: users.length, sub: `+${newThisWeek} cette semaine`, accent: "#0F0F0F" },
              { label: "Taux activation", value: `${activationRate}%`, sub: `${activated} avec événements`, accent: "#2E7D32" },
              { label: "Budget plateforme", value: `${(totalBudget / 1000).toFixed(1)}k`, sub: "toutes devises", accent: "#6A1B9A" },
              { label: "Signalements ouverts", value: openReports, sub: `${reports.length} total`, accent: openReports > 0 ? "#C62828" : "#2E7D32" },
            ].map(k => (
              <div key={k.label} style={{ background: "var(--bg-secondary)", borderRadius: 14, padding: "16px 18px", border: `1px solid var(--border)`, borderLeft: `4px solid ${k.accent}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Playfair Display', serif", color: "var(--text)" }}>{k.value}</div>
                <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 3 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Stats détaillées */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>👥 Utilisateurs</div>
              {[
                { label: "Nouveaux (7j)", value: newThisWeek, color: "#2E7D32" },
                { label: "Nouveaux (30j)", value: newThisMonth, color: "#1565C0" },
                { label: "Actifs", value: activeUsers, color: "#2E7D32" },
                { label: "Bloqués", value: blockedUsers, color: "#C62828" },
                { label: "Taux activation", value: `${activationRate}%`, color: "#F57F17" },
              ].map(s => (
                <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>{s.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</span>
                </div>
              ))}
            </div>
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>📊 Plateforme</div>
              {[
                { label: "Total événements", value: totalEvents, color: "#1565C0" },
                { label: "Moy. événements/user", value: avgEvents, color: "#F57F17" },
                { label: "Budget total géré", value: `${(totalBudget / 1000).toFixed(1)}k`, color: "#6A1B9A" },
                { label: "Signalements ouverts", value: openReports, color: openReports > 0 ? "#C62828" : "#2E7D32" },
                { label: "Signalements total", value: reports.length, color: "#888" },
              ].map(s => (
                <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-sub)" }}>{s.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── UTILISATEURS ── */}
      {activeTab === "users" && (
      <div>
      {/* Filtres */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-secondary)", borderRadius: 10, padding: "8px 12px", border: "1px solid var(--border)", flex: 1, minWidth: 180 }}>
          <span style={{ fontSize: 13, opacity: 0.5 }}>🔍</span>
          <input placeholder="Rechercher un utilisateur..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, width: "100%", fontFamily: "inherit" }} />
        </div>
        <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 10, padding: 3, gap: 2 }}>
          {[["all", "Tous"], ["user", "Actifs"], ["blocked", "Bloqués"], ["admin", "Admins"]].map(([val, lbl]) => (
            <button key={val} onClick={() => setFilterRole(val)}
              style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: filterRole === val ? "#0F0F0F" : "transparent", color: filterRole === val ? "#fff" : "var(--text-muted)", fontSize: 12, fontWeight: filterRole === val ? 700 : 400, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}><Spinner fullscreen={false} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="👤" title="Aucun utilisateur" subtitle="Aucun résultat pour ces critères." />
      ) : isMobile ? (
        // Vue mobile — cartes
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(u => (
            <div key={u.id} style={{ background: "var(--bg-secondary)", borderRadius: 14, padding: "14px 16px", border: `1px solid ${u.user_role === "blocked" ? "#FFCDD2" : "var(--border)"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Avatar name={u.full_name !== "—" ? u.full_name : u.email} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.full_name !== "—" ? u.full_name : u.email}</div>
                    <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
                  </div>
                </div>
                {roleBadge(u.user_role)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12, fontSize: 11 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{u.events_total}</div>
                  <div style={{ color: "var(--text-sub)" }}>Événements</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{u.expenses_total}</div>
                  <div style={{ color: "var(--text-sub)" }}>Charges</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{fmtDateShort(u.last_sign_in)}</div>
                  <div style={{ color: "var(--text-sub)" }}>Dernière co.</div>
                </div>
              </div>
              {u.user_role !== "admin" && (
                <div style={{ display: "flex", gap: 8 }}>
                  {u.user_role === "blocked" ? (
                    <button onClick={() => setConfirm({ action: "unblock", userId: u.id, userName: u.email })}
                      style={{ flex: 1, padding: "7px", borderRadius: 9, border: "1.5px solid #c8e6c9", background: "#E8F5E9", color: "#2E7D32", fontSize: 12, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                      ✓ Débloquer
                    </button>
                  ) : (
                    <button onClick={() => setConfirm({ action: "block", userId: u.id, userName: u.email })}
                      style={{ flex: 1, padding: "7px", borderRadius: 9, border: "1.5px solid #FFE082", background: "#FFF8E1", color: "#F57F17", fontSize: 12, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                      ⊘ Bloquer
                    </button>
                  )}
                  <button onClick={() => setEmailModal({ userId: u.id, userEmail: u.email, userName: u.full_name !== "—" ? u.full_name : u.email })}
                    style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
                    ✉️
                  </button>
                  <button onClick={() => setConfirm({ action: "delete", userId: u.id, userName: u.email })}
                    style={{ padding: "7px 12px", borderRadius: 9, border: "1.5px solid #FFCDD2", background: "#FFEBEE", color: "#C62828", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
                    🗑
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        // Vue desktop — tableau
        <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr style={{ background: "var(--hover-bg)" }}>
                  {["Utilisateur", "Rôle", "Inscription", "Dernière co.", "Événements", "Charges", "Budget", "Actions"].map(h => (
                    <th key={h} style={{ padding: "12px 16px", fontSize: 10, fontWeight: 700, color: "var(--text-sub)", textAlign: "left", textTransform: "uppercase", letterSpacing: 0.7, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, i) => (
                  <tr key={u.id} style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none", opacity: u.user_role === "blocked" ? 0.65 : 1 }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--hover-bg)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Avatar name={u.full_name !== "—" ? u.full_name : u.email} size={30} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{u.full_name !== "—" ? u.full_name : "—"}</div>
                          <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>{roleBadge(u.user_role)}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{fmtDate(u.created_at)}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{fmtDate(u.last_sign_in)}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{u.events_total}</span>
                        {u.events_open > 0 && <span style={{ fontSize: 10, color: "#2E7D32", fontWeight: 600 }}>({u.events_open} ouvert{u.events_open > 1 ? "s" : ""})</span>}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{u.expenses_total}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>
                      {u.budget_total > 0 ? `${(u.budget_total).toFixed(0)}` : "—"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {u.user_role !== "admin" ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          {u.user_role === "blocked" ? (
                            <button onClick={() => setConfirm({ action: "unblock", userId: u.id, userName: u.email })} disabled={acting === u.id}
                              style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #c8e6c9", background: "#E8F5E9", color: "#2E7D32", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                              ✓ Débloquer
                            </button>
                          ) : (
                            <button onClick={() => setConfirm({ action: "block", userId: u.id, userName: u.email })} disabled={acting === u.id}
                              style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #FFE082", background: "#FFF8E1", color: "#F57F17", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                              ⊘ Bloquer
                            </button>
                          )}
                          <button onClick={() => setEmailModal({ userId: u.id, userEmail: u.email, userName: u.full_name !== "—" ? u.full_name : u.email })} disabled={acting === u.id}
                            style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                            ✉️
                          </button>
                          <button onClick={() => setConfirm({ action: "delete", userId: u.id, userName: u.email })} disabled={acting === u.id}
                            style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #FFCDD2", background: "#FFEBEE", color: "#C62828", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                            🗑
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--text-sub)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-sub)" }}>
            {filtered.length} utilisateur{filtered.length > 1 ? "s" : ""} affiché{filtered.length > 1 ? "s" : ""}
          </div>
        </div>
      )}
      </div>
      )} {/* fin onglet users */}

      {/* ── SIGNALEMENTS ── */}
      {activeTab === "reports" && (
        <div>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-sub)" }}>Chargement...</div>
          ) : reports.length === 0 ? (
            <EmptyState icon="✅" title="Aucun signalement" subtitle="Aucun utilisateur n'a signalé de problème." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {reports.map(r => {
                const statusColor = r.status === "open" ? "#C62828" : r.status === "resolved" ? "#2E7D32" : "#888";
                const statusBg = r.status === "open" ? "#FFEBEE" : r.status === "resolved" ? "#E8F5E9" : "#f5f5f5";
                const statusLabel = r.status === "open" ? "🔴 Ouvert" : r.status === "resolved" ? "✅ Résolu" : "📦 Archivé";
                return (
                  <div key={r.id} style={{ background: "var(--bg-secondary)", borderRadius: 14, border: `1px solid ${r.status === "open" ? "#FFCDD2" : "var(--border)"}`, padding: "16px 18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.user_email}</span>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: "#E3F2FD", color: "#1565C0", fontWeight: 700, flexShrink: 0 }}>{reportCategoryLabel[r.category] || r.category}</span>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: statusBg, color: statusColor, fontWeight: 700, flexShrink: 0 }}>{statusLabel}</span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-sub)", flexShrink: 0 }}>{new Date(r.created_at).toLocaleDateString("fr-FR")}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, marginBottom: 12 }}>{r.message}</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {r.status === "open" && (
                        <button onClick={() => handleUpdateReportStatus(r.id, "resolved")} disabled={updatingReport === r.id}
                          style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #c8e6c9", background: "#E8F5E9", color: "#2E7D32", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                          ✅ Marquer résolu
                        </button>
                      )}
                      {r.status !== "archived" && (
                        <button onClick={() => handleUpdateReportStatus(r.id, "archived")} disabled={updatingReport === r.id}
                          style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--hover-bg)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
                          📦 Archiver
                        </button>
                      )}
                      <button onClick={() => setEmailModal({ userId: r.user_id, userEmail: r.user_email, userName: r.user_email })}
                        style={{ padding: "5px 12px", borderRadius: 8, border: "1.5px solid #BBDEFB", background: "#E3F2FD", color: "#1565C0", fontSize: 11, cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
                        ✉️ Répondre par email
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TEMPLATE PDF UNIFIÉ ─────────────────────────────────────
export function buildPDF({ title, subtitle, docType, meta = [], summaryItems = [], sections = [], printAuto = true }) {
  const now = new Date().toLocaleString('fr-FR');
  const dateOnly = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const metaHTML = meta.map(m => `
    <div class="meta-item">
      <div>${m.label}</div>
      <div class="meta-value">${m.value}</div>
    </div>`).join('');

  const summaryHTML = summaryItems.map(s => `
    <div class="summary-item" style="${s.accent ? `border-top: 3px solid ${s.accent}` : ''}">
      <div class="summary-label">${s.label}</div>
      <div class="summary-value" style="${s.color ? `color:${s.color}` : ''}">${s.value}</div>
      ${s.sub ? `<div class="summary-sub">${s.sub}</div>` : ''}
    </div>`).join('');

  const sectionsHTML = sections.map(s => `
    <div class="section">
      <div class="section-title">${s.title}</div>
      ${s.content}
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>SplitLy — ${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', Arial, sans-serif; color: #1a1a1a; background: #fff; }
    .header { background: linear-gradient(135deg, #0F0F0F 0%, #1a1a2e 100%); color: #fff; padding: 36px 40px 28px; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .logo { font-size: 28px; font-weight: 800; letter-spacing: -1px; }
    .doc-type { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 6px; }
    .event-name { font-size: 22px; font-weight: 700; }
    .header-sub { font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 4px; }
    .header-meta { display: flex; gap: 24px; flex-wrap: wrap; }
    .meta-item { font-size: 12px; color: rgba(255,255,255,0.6); }
    .meta-value { font-size: 14px; font-weight: 600; color: #fff; margin-top: 2px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0; border-bottom: 2px solid #f0f0f0; }
    .summary-item { padding: 20px 24px; border-right: 1px solid #f0f0f0; }
    .summary-item:last-child { border-right: none; }
    .summary-label { font-size: 10px; font-weight: 700; color: #aaa; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .summary-value { font-size: 20px; font-weight: 800; color: #0F0F0F; }
    .summary-sub { font-size: 11px; color: #aaa; margin-top: 3px; }
    .section { padding: 28px 40px; border-bottom: 1px solid #f5f5f5; }
    .section-title { font-size: 13px; font-weight: 700; color: #0F0F0F; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    .section-title::before { content: ''; display: inline-block; width: 4px; height: 16px; background: #0F0F0F; border-radius: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    thead tr { background: #0F0F0F; color: #fff; }
    thead th { padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }
    tbody tr:nth-child(even) { background: #f9f9f9; }
    tfoot tr { background: #f0f0f0; font-weight: 700; }
    tfoot td { padding: 10px 12px; }
    .cat-bar { margin-bottom: 10px; }
    .cat-bar-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 12px; }
    .cat-bar-track { background: #eee; height: 6px; border-radius: 3px; overflow: hidden; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 700; }
    .info-box { background: #FFF8E1; border: 1px solid #FFE082; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #E65100; margin-bottom: 16px; }
    .footer { padding: 20px 40px; background: #f9f9f9; display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #f0f0f0; }
    .footer-logo { font-size: 15px; font-weight: 800; color: #0F0F0F; }
    .footer-text { font-size: 10px; color: #aaa; text-align: right; line-height: 1.6; }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div>
        <div class="doc-type">${docType}</div>
        <div class="event-name">${title}</div>
        ${subtitle ? `<div class="header-sub">${subtitle}</div>` : ''}
      </div>
      <div class="logo">SplitLy</div>
    </div>
    <div class="header-meta">${metaHTML}</div>
  </div>
  ${summaryItems.length > 0 ? `<div class="summary">${summaryHTML}</div>` : ''}
  ${sectionsHTML}
  <div class="footer">
    <div>
      <div class="footer-logo">SplitLy</div>
      <div style="font-size:10px;color:#aaa;margin-top:2px">Gestion de dépenses partagées · splitmeapp.com</div>
    </div>
    <div class="footer-text">
      <div>Document généré le ${now}</div>
      <div>Document non contractuel — Référence au ${dateOnly}</div>
    </div>
  </div>
  ${printAuto ? '<script>window.onload = () => setTimeout(() => window.print(), 600);</script>' : ''}
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// ─── EXPORT PDF COTISATIONS ───────────────────────────────────
export function exportCotisationsPDF(ev, cotisations) {
  const sym = currencySymbol(ev.currency);
  const fmt2 = n => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
  const totalCollecte = cotisations.filter(c => c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const totalNature = cotisations.filter(c => c.forme === "nature").reduce((s, c) => s + c.montant, 0);
  const totalEspeces = cotisations.filter(c => c.forme === "especes" && c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const participants = (ev.event_participants || []).map(p => p.name);
  const cotisants = new Set(cotisations.filter(c => c.statut === "paye").map(c => c.participant_name));
  const nonCotisants = participants.filter(p => !cotisants.has(p));

  const rows = cotisations.map((c, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'}">
      <td style="padding:9px 12px;font-weight:600">${c.participant_name}</td>
      <td style="padding:9px 12px"><span class="badge" style="background:${c.forme === "nature" ? "#E8F5E9" : "#E3F2FD"};color:${c.forme === "nature" ? "#2E7D32" : "#1565C0"}">${c.forme === "nature" ? "🌿 Nature" : "💵 Espèces"}</span></td>
      <td style="padding:9px 12px"><span class="badge" style="background:${c.statut === "paye" ? "#E8F5E9" : c.statut === "partiel" ? "#FFF8E1" : "#FFEBEE"};color:${c.statut === "paye" ? "#2E7D32" : c.statut === "partiel" ? "#F57F17" : "#C62828"}">${c.statut === "paye" ? "✓ Payé" : c.statut === "partiel" ? "~ Partiel" : "✗ Impayé"}</span></td>
      <td style="padding:9px 12px;color:#888;font-size:11px">${c.description || "—"}</td>
      <td style="padding:9px 12px;text-align:right;font-weight:700">${fmt2(c.montant)}</td>
    </tr>`).join('');

  const catBars = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="cat-bar"><div class="cat-bar-label"><span>💵 Espèces</span><strong>${fmt2(totalEspeces)}</strong></div><div class="cat-bar-track"><div style="background:#1565C0;height:6px;width:${totalCollecte > 0 ? (totalEspeces / totalCollecte) * 100 : 0}%;border-radius:3px"></div></div></div>
      <div class="cat-bar"><div class="cat-bar-label"><span>🌿 Nature</span><strong>${fmt2(totalNature)}</strong></div><div class="cat-bar-track"><div style="background:#2E7D32;height:6px;width:${totalCollecte > 0 ? (totalNature / totalCollecte) * 100 : 0}%;border-radius:3px"></div></div></div>
    </div>`;

  buildPDF({
    title: ev.name,
    subtitle: "Bilan des cotisations",
    docType: "Rapport Cotisations · Événement Budget",
    meta: [
      { label: "Date de l'événement", value: ev.date },
      { label: "Participants", value: `${participants.length} personne${participants.length > 1 ? 's' : ''}` },
      { label: "Devise", value: sym },
      { label: "Cotisation cible", value: ev.cotisation_cible > 0 ? fmt2(ev.cotisation_cible) + '/p.' : 'Libre' },
    ],
    summaryItems: [
      { label: "Total collecté", value: fmt2(totalCollecte), sub: `${cotisants.size} cotisant(s)`, accent: "#2E7D32", color: "#2E7D32" },
      { label: "En espèces", value: fmt2(totalEspeces), sub: "virements + cash", accent: "#1565C0" },
      { label: "En nature", value: fmt2(totalNature), sub: "valorisation", accent: "#6A1B9A" },
      { label: "Taux collecte", value: ev.cotisation_cible > 0 ? `${((totalCollecte / (ev.cotisation_cible * participants.length)) * 100).toFixed(0)}%` : `${cotisants.size}/${participants.length}`, sub: ev.cotisation_cible > 0 ? `objectif ${fmt2(ev.cotisation_cible * participants.length)}` : "participants" },
    ],
    sections: [
      { title: "Répartition par forme", content: catBars },
      {
        title: `Détail des cotisations (${cotisations.length})`,
        content: `<table>
          <thead><tr><th>Participant</th><th>Forme</th><th>Statut</th><th>Description</th><th style="text-align:right">Montant</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="4">TOTAL COLLECTÉ</td><td style="text-align:right;color:#2E7D32">${fmt2(totalCollecte)}</td></tr></tfoot>
        </table>`
      },
      nonCotisants.length > 0
        ? { title: "Participants sans cotisation", content: `<div style="background:#FFEBEE;border:1px solid #FFCDD2;border-radius:8px;padding:12px 16px;color:#C62828;font-size:13px">⚠️ ${nonCotisants.length} participant(s) n'ont pas encore cotisé : <strong>${nonCotisants.join(', ')}</strong></div>` }
        : { title: "Statut général", content: `<div style="background:#E8F5E9;border:1px solid #C8E6C9;border-radius:8px;padding:12px 16px;color:#2E7D32;font-size:13px">✓ Tous les participants ont cotisé.</div>` }
    ],
  });
}
