// src/pages/Dashboard.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { fetchCotisations, exportPDF } from "../supabase.js";
import { useTranslation } from "../i18n.jsx";

export function Dashboard({ events, expenses, contributions, user, isMobile, navigateTo, t, lang }) {
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] || "vous";
  const now = new Date();
  // Lire la langue sauvegardée depuis localStorage plutôt que le navigateur
  const savedLang = (() => { try { return localStorage.getItem("splitly_lang") || lang; } catch { return lang || "fr"; } })();
  const locale = savedLang === "ar" ? "ar-MA" : savedLang === "en" ? "en-GB" : savedLang === "es" ? "es-ES" : savedLang === "pt" ? "pt-PT" : "fr-FR";
  const dateLabel = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });

  // ── KPIs globaux ──────────────────────────────────────────
  const grandTotal = expenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const openEvents = events.filter(e => e.status === "open");
  const closedEvents = events.filter(e => e.status === "closed");
  const uniqueParticipants = [...new Set(events.flatMap(e => (e.event_participants || []).map(p => p.name)))];

  // ── Soldes consolidés (tous events ouverts) ───────────────
  let totalToReceive = 0, totalToPay = 0, pendingReimb = 0;
  openEvents.forEach(ev => {
    const evExp = expenses.filter(e => e.event_id === ev.id);
    const evContribs = {};
    (contributions[ev.id] || []).forEach(c => { evContribs[c.participant] = c.amount; });
    const txns = computeTransactions(evExp, evContribs, (ev.event_participants || []).map(p => p.name));
    pendingReimb += txns.length;
  });

  // ── Activité récente (10 dernières charges) ───────────────
  const recentExpenses = [...expenses]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 5);

  // ── Top catégories ────────────────────────────────────────
  const byCategory = Object.keys(CATEGORIES).map(cat => ({
    cat, total: expenses.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0)
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total).slice(0, 5);

  // ── Progression bouclage par event ouvert ─────────────────
  const evProgression = openEvents.map(ev => {
    const evExp = expenses.filter(e => e.event_id === ev.id);
    const participants = (ev.event_participants || []).map(p => p.name);
    const evContribs = {};
    (contributions[ev.id] || []).forEach(c => { evContribs[c.participant] = c.amount; });
    const settled = participants.filter(p => isSettled(computeNetBalance(evExp, evContribs, p))).length;
    const pct = participants.length > 0 ? Math.round((settled / participants.length) * 100) : 0;
    const total = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
    return { ev, participants, settled, pct, total, sym: currencySymbol(ev.currency) };
  });

  const KpiCard = ({ icon, label, value, sub, accent, onClick }) => (
    <div onClick={onClick} style={{ background: "var(--bg-secondary)", borderRadius: 16, padding: "18px 20px", border: `1px solid var(--border)`, borderLeft: `4px solid ${accent}`, cursor: onClick ? "pointer" : "default", transition: "box-shadow 0.15s" }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 0.9 }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'Playfair Display', serif", color: "var(--text)", letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-sub)", marginTop: 4 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      {/* ── En-tête ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 24 : 28, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>
            {t ? t("dash_hello") : "Bonjour"}, {firstName} 👋
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>{dateLabel}</p>
        </div>
        {navigateTo && (
          <button onClick={() => navigateTo("events")} style={{ ...S.btnDark, fontSize: 12, padding: "8px 16px" }}>
            + Nouvel événement
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <EmptyState icon="🎊" title={t("dash_no_events")} subtitle={t("dash_no_events_desc")}
          action={navigateTo && <button onClick={() => navigateTo("events")} style={S.btnDark}>{t("dash_create_event_btn")}</button>} />
      ) : (
        <>
          {/* ── KPIs ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 24, minWidth: 0 }}>
            <KpiCard icon="💰" label={t("dash_budget_total")} value={fmt(grandTotal)} sub={`${expenses.length} charge${expenses.length > 1 ? "s" : ""}`} accent="#0F0F0F" onClick={() => navigateTo && navigateTo("expenses")} />
            <KpiCard icon="🎊" label={t("dash_events")} value={events.length} sub={`${openEvents.length} ${t("dash_open_count")}${openEvents.length > 1 ? "s" : ""} · ${closedEvents.length} ${t("dash_closed_count")}${closedEvents.length > 1 ? "s" : ""}`} accent="#2E7D32" onClick={() => navigateTo && navigateTo("events")} />
            <KpiCard icon="👥" label={t("dash_participants")} value={uniqueParticipants.length} sub={t("dash_unique_profiles")} accent="#1565C0" onClick={() => navigateTo && navigateTo("analytics")} />
            <KpiCard icon="⏳" label={t("dash_reimbursements_label")} value={pendingReimb} sub={t("dash_pending")} accent={pendingReimb > 0 ? "#F57F17" : "#2E7D32"} onClick={() => navigateTo && navigateTo("balance")} />
          </div>

          {/* ── Progression bouclage ── */}
          {evProgression.length > 0 && (
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20, marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>📈 Progression vers bouclage</div>
                <button onClick={() => navigateTo && navigateTo("balance")} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>{t("dash_see_balances")}</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {evProgression.map(({ ev, participants, settled, pct, total, sym }) => (
                  <div key={ev.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 14 }}>🎊</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</span>
                        <span style={{ fontSize: 10, color: "var(--text-sub)", flexShrink: 0 }}>{ev.date}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: "var(--text-sub)" }}>{settled}/{participants.length} " " + t("dash_settled_count")</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{fmt(total, sym)}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? "#2E7D32" : "#F57F17" }}>{pct}%</span>
                      </div>
                    </div>
                    <div style={{ background: "var(--border)", borderRadius: 6, height: 6, overflow: "hidden" }}>
                      <div style={{ background: pct === 100 ? "#2E7D32" : "#F57F17", borderRadius: 6, height: 6, width: `${pct}%`, transition: "width 0.6s ease" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Grille basse : top catégories + activité récente ── */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>

            {/* Top catégories */}
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, padding: 20, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🏷️ Top catégories</div>
                <button onClick={() => navigateTo && navigateTo("analytics")} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>{t("dash_analytics_link")}</button>
              </div>
              {byCategory.length === 0 ? (
                <div style={{ color: "var(--text-sub)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>{t("dash_no_charges")}</div>
              ) : byCategory.map(c => (
                <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 18, flexShrink: 0, width: 26 }}>{CATEGORIES[c.cat].icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.cat}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", flexShrink: 0, marginLeft: 8 }}>
                        {grandTotal > 0 ? ((c.total / grandTotal) * 100).toFixed(0) : 0}%
                      </span>
                    </div>
                    <div style={{ background: "var(--border)", borderRadius: 6, height: 5, overflow: "hidden" }}>
                      <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 6, height: 5, width: `${grandTotal > 0 ? (c.total / grandTotal) * 100 : 0}%`, transition: "width 0.5s" }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", flexShrink: 0, minWidth: 48, textAlign: "right" }}>{fmt(c.total)}</span>
                </div>
              ))}
            </div>

            {/* Activité récente */}
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, padding: 20, border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🕐 Activité récente</div>
                <button onClick={() => navigateTo && navigateTo("expenses")} style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>{t("dash_all_expenses")}</button>
              </div>
              {recentExpenses.length === 0 ? (
                <div style={{ color: "var(--text-sub)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>{t("dash_no_recent")}</div>
              ) : recentExpenses.map((ex, i) => {
                const ev = events.find(e => e.id === ex.event_id);
                const cat = CATEGORIES[ex.category];
                const total = ex.qty * (ex.unit_price ?? 0);
                const sym = currencySymbol(ev?.currency);
                return (
                  <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, marginBottom: 12, borderBottom: i < recentExpenses.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: cat?.color || "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{cat?.icon || "🧾"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail || "—"}</div>
                      <div style={{ fontSize: 10, color: "var(--text-sub)", marginTop: 2 }}>{ev?.name} · {ex.is_unpaid ? t("dash_not_paid") : `${t("dash_paid_by")} ${ex.paid_by}`}</div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{fmt(total, sym)}</div>
                  </div>
                );
              })}
            </div>

          </div>
        </>
      )}
    </div>
  );
}
