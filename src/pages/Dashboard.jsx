// src/pages/Dashboard.jsx
import { useState } from "react";
import { CATEGORIES, PERSONAL_CATEGORIES } from "../constants.js";
import { fmt, currencySymbol, computeNetBalance, isSettled, computeTransactions } from "../utils.js";
import { EmptyState } from "../components/ui/index.jsx";
import { BentoGrid, BentoCard, BentoCardHeader, BentoCardTitle, BentoCardContent } from "../components/ui/bento.jsx";
import { cn } from "@/lib/utils";
import { useTranslation } from "../i18n.jsx";

export function Dashboard({ events, expenses, contributions, user, isMobile, navigateTo, lang, personalExpenses = [] }) {
  const { t } = useTranslation();
  const [dashFilter, setDashFilter] = useState("all");
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] || "vous";
  const now = new Date();
  const savedLang = (() => { try { return localStorage.getItem("splitly_lang") || lang; } catch { return lang || "fr"; } })();
  const locale = savedLang === "ar" ? "ar-MA" : savedLang === "en" ? "en-GB" : savedLang === "es" ? "es-ES" : savedLang === "pt" ? "pt-PT" : "fr-FR";
  const dateLabel = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });

  const hasBudgetEvents = events.some(e => e.event_type === "budget");
  const hasPersonalExpenses = personalExpenses.length > 0 || events.some(e => e.event_type === "personal");

  const filteredEvents = dashFilter === "all"
    ? events.filter(e => e.event_type !== "personal")
    : dashFilter === "personal"
      ? []
      : events.filter(e => e.event_type === dashFilter);
  const filteredExpenses = dashFilter === "personal"
    ? personalExpenses
    : expenses.filter(e => filteredEvents.some(ev => ev.id === e.event_id));

  const grandTotal = filteredExpenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const openEvents = filteredEvents.filter(e => e.status === "open");
  const closedEvents = filteredEvents.filter(e => e.status === "closed");
  const uniqueParticipants = [...new Set(filteredEvents.flatMap(e => (e.event_participants || []).map(p => p.name)))];

  let pendingReimb = 0;
  openEvents.forEach(ev => {
    const evExp = expenses.filter(e => e.event_id === ev.id);
    const evContribs = {};
    (contributions[ev.id] || []).forEach(c => { evContribs[c.participant] = c.amount; });
    const txns = computeTransactions(evExp, evContribs, (ev.event_participants || []).map(p => p.name));
    pendingReimb += txns.length;
  });

  const thisMonth = now.getMonth(), thisYear = now.getFullYear();
  const prevMonth = thisMonth === 0 ? 11 : thisMonth - 1;
  const prevYear  = thisMonth === 0 ? thisYear - 1 : thisYear;
  const curMonthExp  = personalExpenses.filter(e => { const d = new Date(e.created_at); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; });
  const prevMonthExp = personalExpenses.filter(e => { const d = new Date(e.created_at); return d.getMonth() === prevMonth && d.getFullYear() === prevYear; });
  const personalTotal     = curMonthExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const personalPrevTotal = prevMonthExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const personalVariation = personalPrevTotal > 0 ? Math.round(((personalTotal - personalPrevTotal) / personalPrevTotal) * 100) : null;
  const personalAvgDay    = personalTotal / (now.getDate() || 1);
  const byCatPersonal = {};
  curMonthExp.forEach(e => { byCatPersonal[e.category] = (byCatPersonal[e.category] || 0) + e.qty * (e.unit_price ?? 0); });
  const topCatEntry = Object.entries(byCatPersonal).sort((a, b) => b[1] - a[1])[0];

  const recentExpenses = [...filteredExpenses]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 5);

  const catDict = dashFilter === "personal" ? PERSONAL_CATEGORIES : CATEGORIES;
  const byCategory = Object.keys(dashFilter === "personal" ? byCatPersonal : catDict).map(cat => ({
    cat, total: filteredExpenses.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0)
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total).slice(0, 5);

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

  const filters = [
    { key: "all", label: t("dash_filter_all") || "✦ Tout" },
    { key: "split", label: t("dash_filter_split") || "🎊 Split" },
    ...(hasBudgetEvents ? [{ key: "budget", label: t("dash_filter_budget") || "💼 Budget" }] : []),
    ...(hasPersonalExpenses ? [{ key: "personal", label: t("dash_filter_personal") || "🧍 Perso" }] : []),
  ];

  return (
    <div className="space-y-5 text-left">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold mb-0.5" style={{ color: "var(--text)", fontFamily: "'Playfair Display', serif" }}>
            {t("dash_hello")}, {firstName} 👋
          </h2>
          <p className="text-xs capitalize" style={{ color: "var(--text-sub)" }}>{dateLabel}</p>
        </div>
        {navigateTo && (
          <button
            onClick={() => navigateTo("events")}
            className="bg-primary text-white text-xs font-bold px-4 py-2 rounded-xl border-0 cursor-pointer hover:opacity-90 transition-opacity"
          >
            + {t("dash_create_event_btn")}
          </button>
        )}
      </div>

      {/* ── Filtres ── */}
      {(events.filter(e => e.event_type !== "personal").length > 0 || hasPersonalExpenses) && (
        <div className="flex gap-2 flex-wrap">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setDashFilter(f.key)}
              className={cn(
                "px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border",
                dashFilter === f.key
                  ? "bg-foreground text-background border-transparent"
                  : "bg-transparent text-muted-foreground hover:text-foreground border-border"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {filteredEvents.length === 0 && dashFilter !== "personal" ? (
        <EmptyState
          icon="🎊"
          title={t("dash_no_events")}
          subtitle={t("dash_no_events_desc")}
          action={navigateTo && (
            <button
              onClick={() => navigateTo("events")}
              className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-bold border-0 cursor-pointer hover:opacity-90 transition-opacity"
            >
              {t("dash_create_event_btn")}
            </button>
          )}
        />
      ) : (
        <>
          {/* ── KPI Bento Grid ── */}
          {dashFilter === "personal" ? (
            <BentoGrid className="grid-cols-2 lg:grid-cols-4">
              <BentoCard onClick={() => navigateTo?.("personal")}>
                <BentoCardHeader>
                  <BentoCardTitle>{t("personal_total") || "Total du mois"}</BentoCardTitle>
                  <span className="text-lg">💶</span>
                </BentoCardHeader>
                <BentoCardContent>
                  <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{fmt(personalTotal)}</div>
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-sub)" }}>{curMonthExp.length} dépense{curMonthExp.length !== 1 ? "s" : ""}</p>
                </BentoCardContent>
              </BentoCard>

              <BentoCard>
                <BentoCardHeader>
                  <BentoCardTitle>{t("personal_vs_prev") || "vs mois précédent"}</BentoCardTitle>
                  <span className="text-lg">{personalVariation !== null && personalVariation > 10 ? "📈" : "📉"}</span>
                </BentoCardHeader>
                <BentoCardContent>
                  <div className={cn("text-2xl font-bold", personalVariation !== null && personalVariation > 10 ? "text-danger" : "text-success")}>
                    {personalVariation !== null ? `${personalVariation > 0 ? "+" : ""}${personalVariation}%` : "—"}
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-sub)" }}>
                    {personalPrevTotal > 0 ? `${fmt(personalPrevTotal)} le mois dernier` : "Pas de données"}
                  </p>
                </BentoCardContent>
              </BentoCard>

              <BentoCard>
                <BentoCardHeader>
                  <BentoCardTitle>{t("personal_avg_day") || "Moyenne / jour"}</BentoCardTitle>
                  <span className="text-lg">📅</span>
                </BentoCardHeader>
                <BentoCardContent>
                  <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{fmt(personalAvgDay)}</div>
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-sub)" }}>Jour {now.getDate()}/{new Date(thisYear, thisMonth + 1, 0).getDate()}</p>
                </BentoCardContent>
              </BentoCard>

              <BentoCard onClick={() => navigateTo?.("personal")}>
                <BentoCardHeader>
                  <BentoCardTitle>{t("personal_top_cat") || "Top catégorie"}</BentoCardTitle>
                  <span className="text-lg">🏷️</span>
                </BentoCardHeader>
                <BentoCardContent>
                  <div className="text-xl font-bold truncate" style={{ color: "var(--text)" }}>{topCatEntry ? topCatEntry[0] : "—"}</div>
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-sub)" }}>{topCatEntry ? fmt(topCatEntry[1]) : "Aucune dépense"}</p>
                </BentoCardContent>
              </BentoCard>
            </BentoGrid>
          ) : (
            <BentoGrid className="grid-cols-2 lg:grid-cols-4">
              <BentoCard onClick={() => navigateTo?.("expenses")}>
                <BentoCardHeader>
                  <BentoCardTitle>{t("dash_budget_total")}</BentoCardTitle>
                  <span className="text-lg">💰</span>
                </BentoCardHeader>
                <BentoCardContent>
                  <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{fmt(grandTotal)}</div>
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-sub)" }}>{filteredExpenses.length} charge{filteredExpenses.length !== 1 ? "s" : ""}</p>
                </BentoCardContent>
              </BentoCard>

              <BentoCard onClick={() => navigateTo?.("events")}>
                <BentoCardHeader>
                  <BentoCardTitle>{t("dash_events")}</BentoCardTitle>
                  <span className="text-lg">🎊</span>
                </BentoCardHeader>
                <BentoCardContent>
                  <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{filteredEvents.length}</div>
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-sub)" }}>
                    {openEvents.length} ouvert{openEvents.length !== 1 ? "s" : ""} · {closedEvents.length} fermé{closedEvents.length !== 1 ? "s" : ""}
                  </p>
                </BentoCardContent>
              </BentoCard>

              <BentoCard onClick={() => navigateTo?.("analytics")}>
                <BentoCardHeader>
                  <BentoCardTitle>{t("dash_participants")}</BentoCardTitle>
                  <span className="text-lg">👥</span>
                </BentoCardHeader>
                <BentoCardContent>
                  <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{uniqueParticipants.length}</div>
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-sub)" }}>{t("dash_unique_profiles")}</p>
                </BentoCardContent>
              </BentoCard>

              <BentoCard onClick={() => navigateTo?.("balance")}>
                <BentoCardHeader>
                  <BentoCardTitle>{t("dash_reimbursements_label")}</BentoCardTitle>
                  <span className="text-lg">⏳</span>
                </BentoCardHeader>
                <BentoCardContent>
                  <div className={cn("text-2xl font-bold", pendingReimb > 0 ? "text-amber-500" : "text-success")}>
                    {pendingReimb}
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-sub)" }}>{t("dash_pending")}</p>
                </BentoCardContent>
              </BentoCard>
            </BentoGrid>
          )}

          {/* ── Main content grid ── */}
          <BentoGrid>
            {/* Activité récente — large */}
            <BentoCard span={2}>
              <BentoCardHeader>
                <BentoCardTitle>🕐 {t("dash_recent_activity")}</BentoCardTitle>
                <button
                  onClick={() => navigateTo?.("expenses")}
                  className="text-[11px] bg-transparent border-0 cursor-pointer hover:opacity-70 transition-opacity"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("dash_all_expenses")}
                </button>
              </BentoCardHeader>
              <BentoCardContent className="pt-0">
                {recentExpenses.length === 0 ? (
                  <p className="text-[13px] text-center py-5" style={{ color: "var(--text-sub)" }}>{t("dash_no_recent")}</p>
                ) : recentExpenses.map((ex, i) => {
                  const ev = events.find(e => e.id === ex.event_id);
                  const cat = CATEGORIES[ex.category] || PERSONAL_CATEGORIES[ex.category];
                  const total = ex.qty * (ex.unit_price ?? 0);
                  const sym = currencySymbol(ev?.currency);
                  return (
                    <div key={ex.id} className={cn(
                      "flex items-center gap-2.5 py-3",
                      i < recentExpenses.length - 1 && "border-b"
                    )} style={{ borderColor: "var(--border)" }}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0"
                        style={{ background: cat?.color || "var(--muted)" }}>
                        {cat?.icon || "🧾"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold truncate" style={{ color: "var(--text)" }}>
                          {ex.detail || "—"}
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: "var(--text-sub)" }}>
                          {ev?.name} · {ex.is_unpaid ? t("dash_not_paid") : `${t("dash_paid_by")} ${ex.paid_by}`}
                        </div>
                      </div>
                      <div className="text-[13px] font-bold flex-shrink-0" style={{ color: "var(--text)" }}>
                        {fmt(total, sym)}
                      </div>
                    </div>
                  );
                })}
              </BentoCardContent>
            </BentoCard>

            {/* Top catégories */}
            <BentoCard>
              <BentoCardHeader>
                <BentoCardTitle>🏷️ {t("dash_top_categories")}</BentoCardTitle>
                <button
                  onClick={() => navigateTo?.("analytics")}
                  className="text-[11px] bg-transparent border-0 cursor-pointer hover:opacity-70 transition-opacity"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("dash_analytics_link")}
                </button>
              </BentoCardHeader>
              <BentoCardContent className="pt-0">
                {byCategory.length === 0 ? (
                  <p className="text-[13px] text-center py-5" style={{ color: "var(--text-sub)" }}>{t("dash_no_charges")}</p>
                ) : byCategory.map(c => {
                  const catInfo = catDict[c.cat] || CATEGORIES[c.cat] || {};
                  const pct = grandTotal > 0 ? (c.total / grandTotal) * 100 : 0;
                  return (
                    <div key={c.cat} className="flex items-center gap-2.5 mb-3">
                      <span className="text-lg flex-shrink-0 w-6">{catInfo.icon || "🏷️"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between mb-1">
                          <span className="text-[12px] truncate" style={{ color: "var(--text)" }}>{c.cat}</span>
                          <span className="text-[12px] font-bold flex-shrink-0 ml-2" style={{ color: "var(--text)" }}>
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="rounded-full h-1.5 overflow-hidden" style={{ background: "var(--border)" }}>
                          <div
                            className="h-1.5 rounded-full transition-all duration-500"
                            style={{ background: catInfo.accent || "var(--tw-primary)", width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold flex-shrink-0 w-12 text-right" style={{ color: "var(--text-muted)" }}>
                        {fmt(c.total)}
                      </span>
                    </div>
                  );
                })}
              </BentoCardContent>
            </BentoCard>
          </BentoGrid>

          {/* ── Progression bouclage ── */}
          {evProgression.length > 0 && (
            <BentoCard span={3}>
              <BentoCardHeader>
                <BentoCardTitle>📊 {t("dash_progression")}</BentoCardTitle>
                <button
                  onClick={() => navigateTo?.("balance")}
                  className="text-[11px] bg-transparent border-0 cursor-pointer hover:opacity-70 transition-opacity"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("dash_see_balances")}
                </button>
              </BentoCardHeader>
              <BentoCardContent className="pt-0 space-y-4">
                {evProgression.map(({ ev, participants, settled, pct, total, sym }) => (
                  <div key={ev.id}>
                    <div className="flex justify-between items-center mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm">🎊</span>
                        <span className="text-[13px] font-semibold truncate" style={{ color: "var(--text)" }}>{ev.name}</span>
                        <span className="text-[10px] flex-shrink-0" style={{ color: "var(--text-sub)" }}>{ev.date}</span>
                      </div>
                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        <span className="text-[11px]" style={{ color: "var(--text-sub)" }}>
                          {settled}/{participants.length} {t("dash_settled_count")}
                        </span>
                        <span className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{fmt(total, sym)}</span>
                        <span className={cn("text-[11px] font-bold", pct === 100 ? "text-success" : "text-amber-500")}>
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div className="rounded-full h-1.5 overflow-hidden" style={{ background: "var(--border)" }}>
                      <div
                        className="h-1.5 rounded-full transition-all duration-700"
                        style={{
                          background: pct === 100 ? "#10b981" : "#f59e0b",
                          width: `${pct}%`
                        }}
                      />
                    </div>
                  </div>
                ))}
              </BentoCardContent>
            </BentoCard>
          )}
        </>
      )}
    </div>
  );
}
