// src/pages/Analytics.jsx
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { useTranslation } from "../i18n.jsx";

export function Analytics({ events, expenses, contributions, isMobile, defaultTab }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(defaultTab || "all"); // "all" | "event" | "charges" | "personal"
  const [sel, setSel] = useState(events[0]?.id || "");

  // ── Données événement sélectionné ─────────────────────────
  const ev = useMemo(() => events.find(e => e.id === sel), [events, sel]);
  const evExp = useMemo(() => expenses.filter(e => e.event_id === sel), [expenses, sel]);
  const sym = currencySymbol(ev?.currency);
  const budget = useMemo(() => evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0), [evExp]);
  const participants = useMemo(() => (ev?.event_participants || []).map(p => p.name), [ev]);
  const evContribMap = useMemo(() => {
    const m = {};
    (contributions[sel] || []).forEach(c => { m[c.participant] = c.amount; });
    return m;
  }, [contributions, sel]);
  const byCategory = useMemo(() => Object.keys(CATEGORIES).map(cat => ({
    cat, total: evExp.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0)
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total), [evExp]);

  // ── Données tous événements (onglet "Tous") ───────────────
  const allTotal = useMemo(() => expenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0), [expenses]);
  const splitEvents = useMemo(() => events.filter(e => e.event_type !== "budget"), [events]);
  const budgetEvents = useMemo(() => events.filter(e => e.event_type === "budget"), [events]);

  const evRows = useMemo(() => events.map(ev => {
    const exps = expenses.filter(e => e.event_id === ev.id);
    const total = exps.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
    const parts = (ev.event_participants || []).map(p => p.name);
    const contribs = {};
    (contributions[ev.id] || []).forEach(c => { contribs[c.participant] = c.amount; });
    const settled = parts.filter(p => isSettled(computeNetBalance(exps, contribs, p))).length;
    const pct = parts.length > 0 ? Math.round((settled / parts.length) * 100) : 0;
    return { ev, total, parts, settled, pct, expCount: exps.length, sym: currencySymbol(ev.currency) };
  }), [events, expenses, contributions]);

  // ── Données par charge (onglet "Par charge") ──────────────
  const allByCat = Object.keys(CATEGORIES).map(cat => {
    const catExps = expenses.filter(e => e.category === cat);
    const total = catExps.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
    const count = catExps.length;
    const avg = count > 0 ? total / count : 0;
    const max = catExps.reduce((m, e) => Math.max(m, e.qty * (e.unit_price ?? 0)), 0);
    return { cat, total, count, avg, max };
  }).filter(c => c.count > 0).sort((a, b) => b.total - a.total);
  const topExpenses = [...expenses].sort((a, b) => (b.qty * (b.unit_price ?? 0)) - (a.qty * (a.unit_price ?? 0))).slice(0, 8);

  // ── Données par participant ───────────────────────────────
  const allParticipants = [...new Set(events.flatMap(e => (e.event_participants || []).map(p => p.name)))].sort();
  const [selParticipant, setSelParticipant] = useState(allParticipants[0] || "");

  const personalStats = (name) => {
    const pEvents = events.filter(ev => (ev.event_participants || []).some(p => p.name === name));
    let totalOwed = 0, totalPaid = 0, totalAdvanced = 0, expenseCount = 0;
    const byEv = pEvents.map(ev => {
      const evExps = expenses.filter(e => e.event_id === ev.id);
      const owed = computeOwed(evExps, name);
      const evContribs = {};
      (contributions[ev.id] || []).forEach(c => { evContribs[c.participant] = c.amount; });
      const paid = evContribs[name] || 0;
      const advanced = evExps.filter(e => e.paid_by === name).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
      const net = paid - owed;
      totalOwed += owed; totalPaid += paid; totalAdvanced += advanced;
      expenseCount += evExps.filter(e => (e.included || []).includes(name)).length;
      return { ev, owed, paid, advanced, net };
    });
    const favCat = Object.entries(
      expenses.filter(e => (e.included || []).includes(name))
        .reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + 1; return acc; }, {})
    ).sort((a, b) => b[1] - a[1])[0];
    return { pEvents, byEv, totalOwed, totalPaid, totalAdvanced, expenseCount, netGlobal: totalPaid - totalOwed, favCat };
  };
  const ps = selParticipant ? personalStats(selParticipant) : null;

  const allCurrencies = [...new Set(events.map(e => e.currency))];
  const mixedCurrencies = allCurrencies.length > 1;

  const TABS = [
    { key: "all",      label: t ? "🌐 " + t("ana_all_events") : "🌐 Tous" },
    { key: "event",    label: t ? "📊 " + t("ana_by_event") : "📊 Par événement" },
    { key: "charges",  label: t ? "🏷️ " + t("ana_by_charge") : "🏷️ Par charge" },
    { key: "personal", label: t ? "👤 " + t("ana_by_participant_tab") : "👤 Par participant" },
  ];

  const TabBar = () => (
    <div style={{ display: "flex", background: "var(--hover-bg)", borderRadius: 12, padding: 3, gap: 2, flexWrap: "wrap" }}>
      {TABS.map(tb => (
        <button key={tb.key} onClick={() => setTab(tb.key)}
          style={{ padding: isMobile ? "6px 10px" : "7px 14px", borderRadius: 9, border: "none", background: tab === tb.key ? "#0F0F0F" : "transparent", color: tab === tb.key ? "#fff" : "var(--text-muted)", fontSize: isMobile ? 11 : 12, fontWeight: tab === tb.key ? 700 : 400, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap" }}>
          {tb.label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2, color: "var(--text)" }}>{t ? t("ana_title") : "Analyses"}</h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>{t ? t("ana_subtitle") : "Statistiques détaillées"}</p>
        </div>
        <TabBar />
      </div>

      {mixedCurrencies && (
        <div style={{ background: "#FFF8E1", border: "1px solid #FFE082", borderRadius: 12, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#E65100" }}>
          ⚠️ Devises mixtes ({allCurrencies.map(currencySymbol).join(", ")}) — montants non cumulables entre événements.
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET TOUS
      ══════════════════════════════════════════════════════ */}
      {tab === "all" && (
        <div>
          {/* KPIs globaux — séparés Split et Budget */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: splitEvents.length > 0 && budgetEvents.length > 0 ? 8 : 20 }}>
            <StatCard label="Événements" value={events.length} sub={`${splitEvents.length} Split · ${budgetEvents.length} Budget`} accent="#0F0F0F" />
            <StatCard label="Charges totales" value={expenses.length} sub="toutes catégories" accent="#1565C0" />
            <StatCard label="Participants" value={allParticipants.length} sub="profils uniques" accent="#6A1B9A" />
            <StatCard label="Budget cumulé" value={fmt(allTotal)} sub="toutes devises" accent="#2E7D32" />
          </div>
          {/* Bandeau informatif si mix Split + Budget */}
          {splitEvents.length > 0 && budgetEvents.length > 0 && (
            <div style={{ background: "#E3F2FD", border: "1px solid #BBDEFB", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 12, color: "#1565C0" }}>
              ℹ️ Le budget cumulé inclut les charges Split ({splitEvents.length} événement{splitEvents.length > 1 ? "s" : ""}) et les dépenses Budget ({budgetEvents.length} événement{budgetEvents.length > 1 ? "s" : ""}). Les cotisations Budget ne sont pas incluses dans ce total.
            </div>
          )}

          {/* Tableau synthèse par événement */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", marginBottom: 20 }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              Synthèse par événement
            </div>
            {evRows.length === 0 ? <EmptyState icon="🎊" title="Aucun événement" subtitle="" /> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
                  <thead>
                    <tr style={{ background: "var(--hover-bg)" }}>
                      {["Événement", "Date", "Participants", "Charges", "Budget", "Progression"].map(h => (
                        <th key={h} style={{ padding: "10px 16px", fontSize: 10, fontWeight: 700, color: "var(--text-sub)", textAlign: "left", textTransform: "uppercase", letterSpacing: 0.7, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {evRows.map(({ ev, total, parts, settled, pct, expCount, sym }, i) => (
                      <tr key={ev.id} style={{ borderBottom: i < evRows.length - 1 ? "1px solid var(--border)" : "none" }}>
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ flexShrink: 0 }}>{ev.status === "closed" ? "🔒" : ev.event_type === "budget" ? "🏦" : "🎊"}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Truncate text={ev.name} max={16} /></span>
                            </div>
                            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 20, background: ev.event_type === "budget" ? "#FFF8E1" : "#F3E5F5", color: ev.event_type === "budget" ? "#F57F17" : "#6A1B9A", fontWeight: 700, width: "fit-content" }}>
                              {ev.event_type === "budget" ? "Budget" : "Split"}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-sub)", whiteSpace: "nowrap" }}>{ev.date}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text)", textAlign: "center" }}>{parts.length}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text)", textAlign: "center" }}>{expCount}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>{fmt(total, sym)}</td>
                        <td style={{ padding: "12px 16px", minWidth: 120 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, background: "var(--border)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                              <div style={{ background: pct === 100 ? "#2E7D32" : "#F57F17", height: 6, width: `${pct}%`, borderRadius: 4, transition: "width 0.5s" }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? "#2E7D32" : "#F57F17", flexShrink: 0 }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Top catégories global */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>{t ? t("ana_top_categories") : "Top catégories — tous événements"}</div>
            {allByCat.slice(0, 6).map(c => (
              <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 18, width: 26, flexShrink: 0 }}>{CATEGORIES[c.cat].icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--text)" }}>{c.cat}</span>
                    <span style={{ fontSize: 11, color: "var(--text-sub)", flexShrink: 0, marginLeft: 8 }}>{c.count} charge{c.count > 1 ? "s" : ""}</span>
                  </div>
                  <div style={{ background: "var(--border)", borderRadius: 6, height: 6, overflow: "hidden" }}>
                    <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 6, height: 6, width: `${allTotal > 0 ? (c.total / allTotal) * 100 : 0}%`, transition: "width 0.5s" }} />
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", flexShrink: 0, minWidth: 52, textAlign: "right" }}>{fmt(c.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET PAR ÉVÉNEMENT
      ══════════════════════════════════════════════════════ */}
      {tab === "event" && (
        <div>
          {/* Sélecteur événement */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {events.map(ev => (
              <button key={ev.id} onClick={() => setSel(ev.id)}
                style={{ padding: "7px 14px", borderRadius: 20, border: `1.5px solid ${sel === ev.id ? "#0F0F0F" : "var(--border)"}`, background: sel === ev.id ? "#0F0F0F" : "var(--bg-secondary)", color: sel === ev.id ? "#fff" : "var(--text-muted)", fontSize: 12, cursor: "pointer", fontWeight: sel === ev.id ? 700 : 400, transition: "all 0.15s" }}>
                {ev.status === "closed" ? "🔒 " : ""}<Truncate text={ev.name} max={20} />
                <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 10 }}>({currencySymbol(ev.currency)})</span>
              </button>
            ))}
          </div>

          {!ev ? (
            <EmptyState icon="📊" title="Sélectionnez un événement" subtitle="Choisissez un événement pour voir ses statistiques." />
          ) : (
            <>
              {/* KPIs événement */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                <StatCard label="Budget collectif" value={fmt(budget, sym)} sub={`${evExp.length} charge${evExp.length > 1 ? "s" : ""}`} accent="#0F0F0F" />
                <StatCard label="Participants" value={participants.length} sub={`Moy. ${fmt(participants.length > 0 ? budget / participants.length : 0, sym)}/p.`} accent="#1565C0" />
                <StatCard label="Charge max" value={fmt(evExp.reduce((m, e) => Math.max(m, e.qty * (e.unit_price ?? 0)), 0), sym)} sub="dépense unitaire la plus élevée" accent="#F57F17" />
                <StatCard label="Statut" value={ev.status === "closed" ? "Bouclé 🔒" : "Ouvert ✓"} sub={`${ev.date} · ${sym}`} accent={ev.status === "closed" ? "#999" : "#2E7D32"} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                {/* Répartition par catégorie */}
                <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>{t ? t("ana_by_category") : "Répartition par catégorie"}</div>
                  {byCategory.length === 0 ? <EmptyState icon="🧾" title="Aucune charge" subtitle="" /> : byCategory.map(c => (
                    <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ fontSize: 18, flexShrink: 0, width: 26 }}>{CATEGORIES[c.cat].icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: "var(--text)" }}>{c.cat}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{fmt(c.total, sym)} <span style={{ color: "var(--text-sub)", fontWeight: 400 }}>({budget > 0 ? ((c.total / budget) * 100).toFixed(0) : 0}%)</span></span>
                        </div>
                        <div style={{ background: "var(--border)", borderRadius: 6, height: 7, overflow: "hidden" }}>
                          <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 6, height: 7, width: `${budget > 0 ? (c.total / budget) * 100 : 0}%`, transition: "width 0.5s ease" }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Part due + progression par participant */}
                <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>{t ? t("ana_by_participant") : "Part due par participant"}</div>
                  {participants.length === 0 ? <EmptyState icon="👥" title="Aucun participant" subtitle="" /> : participants.map(p => {
                    const owed = computeOwed(evExp, p);
                    const paid = evContribMap[p] || 0;
                    const pct = owed > 0 ? Math.min((paid / owed) * 100, 100) : 100;
                    const net = paid - owed;
                    const settled = isSettled(net);
                    const status = settleStatus(net, owed > 0);
                    return (
                      <div key={p} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                        <Avatar name={p} size={28} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                            <span style={{ fontSize: 11, color: status.color, fontWeight: 700, flexShrink: 0, marginLeft: 4 }}>
                              {settled ? "✓ Soldé" : `${fmt(paid, sym)} / ${fmt(owed, sym)}`}
                            </span>
                          </div>
                          <div style={{ background: "var(--border)", borderRadius: 6, height: 6, overflow: "hidden" }}>
                            <div style={{ background: status.color, borderRadius: 6, height: 6, width: `${pct}%`, transition: "width 0.4s ease" }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET PAR CHARGE
      ══════════════════════════════════════════════════════ */}
      {tab === "charges" && (
        <div>
          {/* KPIs charges */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <StatCard label="Total charges" value={expenses.length} sub="enregistrées" accent="#0F0F0F" />
            <StatCard label="Montant total" value={fmt(allTotal)} sub="toutes devises" accent="#1565C0" />
            <StatCard label="Moyenne/charge" value={fmt(expenses.length > 0 ? allTotal / expenses.length : 0)} sub="par dépense" accent="#F57F17" />
            <StatCard label="Catégories actives" value={allByCat.length} sub={`sur ${Object.keys(CATEGORIES).length} disponibles`} accent="#2E7D32" />
          </div>

          {/* Barres horizontales par catégorie */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>{t ? t("ana_volume_by_category") : "Volume par catégorie"}</div>
            {allByCat.map(c => (
              <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <span style={{ fontSize: 18, width: 26, flexShrink: 0 }}>{CATEGORIES[c.cat].icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{c.cat}</span>
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-sub)", flexShrink: 0 }}>
                      <span>{c.count} charge{c.count > 1 ? "s" : ""}</span>
                      <span>moy. {fmt(c.avg)}</span>
                      <span style={{ fontWeight: 700, color: "var(--text)" }}>{fmt(c.total)}</span>
                    </div>
                  </div>
                  <div style={{ background: "var(--border)", borderRadius: 6, height: 8, overflow: "hidden" }}>
                    <div style={{ background: CATEGORIES[c.cat].accent, borderRadius: 6, height: 8, width: `${allTotal > 0 ? (c.total / allTotal) * 100 : 0}%`, transition: "width 0.5s" }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Top 8 charges */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              Top charges par montant
            </div>
            {topExpenses.map((ex, i) => {
              const cat = CATEGORIES[ex.category];
              const evItem = events.find(e => e.id === ex.event_id);
              const total = ex.qty * (ex.unit_price ?? 0);
              const evSym = currencySymbol(evItem?.currency);
              const maxTotal = topExpenses[0] ? topExpenses[0].qty * (topExpenses[0].unit_price ?? 0) : 1;
              return (
                <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: i < topExpenses.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontSize: 16, color: "var(--text-sub)", fontWeight: 700, width: 20, flexShrink: 0 }}>#{i + 1}</span>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{cat?.icon || "🧾"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail || "—"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <div style={{ flex: 1, background: "var(--border)", borderRadius: 4, height: 4, overflow: "hidden" }}>
                        <div style={{ background: cat?.accent || "#aaa", height: 4, width: `${(total / maxTotal) * 100}%`, borderRadius: 4, transition: "width 0.4s" }} />
                      </div>
                      <span style={{ fontSize: 10, color: "var(--text-sub)", flexShrink: 0 }}>{evItem?.name}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{fmt(total, evSym)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET PAR PARTICIPANT
      ══════════════════════════════════════════════════════ */}
      {tab === "personal" && (
        <div>
          {/* Sélecteur participant */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {allParticipants.map(p => (
                <button key={p} onClick={() => setSelParticipant(p)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 20, border: `1.5px solid ${selParticipant === p ? "#0F0F0F" : "var(--border)"}`, background: selParticipant === p ? "#0F0F0F" : "var(--bg-secondary)", color: selParticipant === p ? "#fff" : "var(--text-muted)", fontSize: 13, cursor: "pointer", fontWeight: selParticipant === p ? 700 : 400, transition: "all 0.15s" }}>
                  <Avatar name={p} size={20} />
                  {p}
                </button>
              ))}
            </div>
          </div>

          {ps ? (
            <div>
              {/* KPIs participant */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                <StatCard label="Part due totale" value={fmt(ps.totalOwed)} sub={`${ps.expenseCount} charge(s)`} accent="#C62828" />
                <StatCard label="Total avancé" value={fmt(ps.totalAdvanced)} sub="payé pour les autres" accent="#1565C0" />
                <StatCard label="Solde global" value={`${ps.netGlobal >= 0 ? "+" : ""}${fmt(ps.netGlobal)}`} sub={ps.netGlobal >= 0 ? "à recevoir" : "à rembourser"} accent={ps.netGlobal >= 0 ? "#2E7D32" : "#C62828"} />
                <StatCard label="Événements" value={ps.pEvents.length} sub={ps.favCat ? `Fav: ${ps.favCat[0]}` : "—"} accent="#6A1B9A" />
              </div>

              {/* Catégorie favorite */}
              {ps.favCat && (
                <div style={{ background: "var(--bg-secondary)", borderRadius: 14, border: "1px solid var(--border)", padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontSize: 28 }}>{CATEGORIES[ps.favCat[0]]?.icon || "🏷️"}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Catégorie préférée : {ps.favCat[0]}</div>
                    <div style={{ fontSize: 12, color: "var(--text-sub)" }}>{ps.favCat[1]} charge{ps.favCat[1] > 1 ? "s" : ""} dans cette catégorie</div>
                  </div>
                </div>
              )}

              {/* Détail par événement */}
              <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                  Détail par événement
                </div>
                {ps.byEv.map(({ ev, owed, paid, advanced, net }) => {
                  const evSym = currencySymbol(ev.currency);
                  const hasCharges = owed > 0;
                  const status = settleStatus(net, hasCharges);
                  const pct = owed > 0 ? Math.min((paid / owed) * 100, 100) : 100;
                  return (
                    <div key={ev.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: hasCharges ? 8 : 0, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 16 }}>{ev.status === "closed" ? "🔒" : "🎊"}</span>
                        <div style={{ flex: 1, minWidth: 100 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}><Truncate text={ev.name} max={25} /></div>
                          <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{ev.date} · {evSym}</div>
                        </div>
                        {hasCharges && (
                          <div style={{ fontSize: 11, color: "var(--text-sub)" }}>
                            Doit {fmt(owed, evSym)} · Avancé {fmt(advanced, evSym)}
                          </div>
                        )}
                        <span style={{ padding: "4px 10px", borderRadius: 20, background: status.bg, color: status.color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                          {status.label}
                        </span>
                      </div>
                      {hasCharges && (
                        <div style={{ background: "var(--border)", borderRadius: 4, height: 5, overflow: "hidden" }}>
                          <div style={{ background: status.color, height: 5, width: `${pct}%`, borderRadius: 4, transition: "width 0.4s" }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState icon="👤" title="Sélectionnez un participant" subtitle="Choisissez un participant pour voir ses statistiques." />
          )}
        </div>
      )}
    </div>
  );
}
