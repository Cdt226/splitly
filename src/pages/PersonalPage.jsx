// src/pages/PersonalPage.jsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { PERSONAL_CATEGORIES } from "../constants.js";
import { fmt, currencySymbol } from "../utils.js";
import { S } from "../styles.js";
import { Modal, ConfirmModal, Spinner, EmptyState, StatCard } from "../components/ui/index.jsx";
import { OCRCapture } from "../components/OCRCapture.jsx";
import { createExpense, updateExpense, deleteExpense, fetchOrCreatePersonalEvent } from "../supabase.js";
import { useTranslation } from "../i18n.jsx";
import { usePersonalBudgets } from "../hooks/usePersonalBudgets.js";
import { usePersonalInsights } from "../hooks/usePersonalInsights.js";

// ─── PDF EXPORT ───────────────────────────────────────────────
function exportPersonalPDF(month, year, expenses, sym) {
  const monthLabel = new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const total = expenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const fmt2 = n => Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ' + sym;

  const byCat = {};
  expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.qty * (e.unit_price ?? 0); });
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const rows = [...expenses].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map((ex, i) => {
    const amt = ex.qty * (ex.unit_price ?? 0);
    const bg = i % 2 === 0 ? '#fff' : '#f9f9f9';
    const info = PERSONAL_CATEGORIES[ex.category] || {};
    const d = new Date(ex.created_at).toLocaleDateString('fr-FR');
    return `<tr style="background:${bg}">
      <td style="padding:9px 12px">${info.icon || ''} ${ex.category}</td>
      <td style="padding:9px 12px;font-weight:600">${ex.detail}</td>
      <td style="padding:9px 12px">${d}</td>
      <td style="padding:9px 12px;text-align:right;font-weight:700">${fmt2(amt)}</td>
    </tr>`;
  }).join('');

  const catBars = catEntries.map(([cat, amt]) => {
    const info = PERSONAL_CATEGORIES[cat] || {};
    const pct = total > 0 ? ((amt / total) * 100).toFixed(0) : 0;
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-size:12px;font-weight:600">${info.icon || ''} ${cat}</span>
        <span style="font-size:12px;font-weight:700;color:${info.accent || '#333'}">${fmt2(amt)} (${pct}%)</span>
      </div>
      <div style="background:#eee;height:6px;border-radius:3px">
        <div style="background:${info.accent || '#0F0F0F'};height:6px;width:${pct}%;border-radius:3px"></div>
      </div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
  <title>Mes dépenses — ${monthLabel}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#1a1a1a}
  .header{background:linear-gradient(135deg,#0F0F0F,#1a1a2e);color:#fff;padding:32px 40px}
  .section{padding:24px 40px;border-bottom:1px solid #f5f5f5}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#0F0F0F;margin-bottom:14px;display:flex;align-items:center;gap:8px}
  .section-title::before{content:'';display:inline-block;width:4px;height:14px;background:#0F0F0F;border-radius:2px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  thead tr{background:#0F0F0F;color:#fff}
  thead th{padding:9px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px}
  .summary{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:2px solid #f0f0f0}
  .summary-item{padding:18px 24px;border-right:1px solid #f0f0f0}
  .summary-item:last-child{border-right:none}
  .summary-label{font-size:10px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
  .summary-value{font-size:20px;font-weight:800;color:#0F0F0F}
  .footer{padding:18px 40px;background:#f9f9f9;display:flex;justify-content:space-between;align-items:center}
  @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body>
  <div class="header">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-bottom:6px">Dépenses personnelles</div>
        <div style="font-size:22px;font-weight:700">🧍 ${monthLabel}</div>
      </div>
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px">SplitLy</div>
    </div>
  </div>
  <div class="summary">
    <div class="summary-item"><div class="summary-label">Total</div><div class="summary-value">${fmt2(total)}</div></div>
    <div class="summary-item"><div class="summary-label">Dépenses</div><div class="summary-value">${expenses.length}</div></div>
    <div class="summary-item"><div class="summary-label">Catégories</div><div class="summary-value">${catEntries.length}</div></div>
  </div>
  <div class="section"><div class="section-title">Répartition par catégorie</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${catBars}</div></div>
  <div class="section"><div class="section-title">Détail des dépenses (${expenses.length})</div>
    <table><thead><tr><th>Catégorie</th><th>Description</th><th>Date</th><th style="text-align:right">Montant</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="background:#f0f0f0;font-weight:700"><td colspan="3" style="padding:9px 12px">TOTAL</td><td style="padding:9px 12px;text-align:right">${fmt2(total)}</td></tr></tfoot>
    </table>
  </div>
  <div class="footer"><div><div style="font-size:14px;font-weight:800">SplitLy</div><div style="font-size:10px;color:#aaa">Suivi personnel des dépenses</div></div>
  <div style="font-size:10px;color:#aaa;text-align:right">Généré le ${new Date().toLocaleString('fr-FR')}</div></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),500)</script>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// ─── BUDGET ROW (composant enfant pour éviter useState dans .map()) ─
function BudgetRow({ cat, info, currentLimit, onSave, sym }) {
  const [localVal, setLocalVal] = useState(String(currentLimit || ''));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 20, width: 28, flexShrink: 0 }}>{info.icon}</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{cat}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number"
          min="0"
          step="1"
          value={localVal}
          onChange={e => setLocalVal(e.target.value)}
          onBlur={() => onSave(cat, Number(localVal) || 0)}
          placeholder="0"
          style={{ ...S.input, width: 90, textAlign: "right" }}
        />
        <span style={{ fontSize: 12, color: "var(--text-sub)", whiteSpace: "nowrap" }}>/{sym} mois</span>
      </div>
    </div>
  );
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────
export function PersonalPage({ events, expenses, contributions, user, reload, isMobile, addToast, personalExpenses = [] }) {
  const { t } = useTranslation();
  const now = new Date();

  // ── A. Initialisation event personnel ─────────────────────
  const [initializing, setInitializing] = useState(false);

  useEffect(() => {
    const hasPersonal = events.some(e => e.event_type === 'personal' && e.admin_id === user?.id);
    if (!hasPersonal && user?.id && !initializing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitializing(true);
      fetchOrCreatePersonalEvent(user.id).then(() => {
        reload().finally(() => setInitializing(false));
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, user?.id]);

  // ── B. État local ─────────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [showForm, setShowForm] = useState(false);
  const [editingEx, setEditingEx] = useState(null);
  const [form, setForm] = useState({ category: "Alimentation", sub: "Autre", detail: "", unit_price: "" });
  const [showOCR, setShowOCR] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [dismissedInsights, setDismissedInsights] = useState([]);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  // ── C. Calculs ────────────────────────────────────────────
  const personalEvent = useMemo(
    () => events.find(e => e.event_type === 'personal' && e.admin_id === user?.id),
    [events, user?.id]
  );

  const sym = useMemo(() => currencySymbol(personalEvent?.currency || 'EUR €'), [personalEvent]);

  const currentMonthExpenses = useMemo(() =>
    personalExpenses.filter(e => {
      const d = new Date(e.created_at);
      return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
    }),
    [personalExpenses, selectedMonth, selectedYear]
  );

  const prevMonth = selectedMonth === 0 ? 11 : selectedMonth - 1;
  const prevYear  = selectedMonth === 0 ? selectedYear - 1 : selectedYear;

  const prevMonthExpenses = useMemo(() =>
    personalExpenses.filter(e => {
      const d = new Date(e.created_at);
      return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
    }),
    [personalExpenses, prevMonth, prevYear]
  );

  const totalMonth = useMemo(
    () => currentMonthExpenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0),
    [currentMonthExpenses]
  );

  const totalPrev = useMemo(
    () => prevMonthExpenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0),
    [prevMonthExpenses]
  );

  const variation = totalPrev > 0 ? Math.round(((totalMonth - totalPrev) / totalPrev) * 100) : null;

  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const isCurrentMonth = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();
  const daysElapsed = isCurrentMonth ? now.getDate() : daysInMonth;
  const avgPerDay = totalMonth / (daysElapsed || 1);

  const byCat = useMemo(() => {
    const map = {};
    currentMonthExpenses.forEach(e => {
      const amt = e.qty * (e.unit_price ?? 0);
      map[e.category] = (map[e.category] || 0) + amt;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [currentMonthExpenses]);

  const topCategory = byCat[0] || null;

  // ── D. Hooks ──────────────────────────────────────────────
  const { limits, setLimit, getLimitForCategory } = usePersonalBudgets(user?.id);

  const insights = usePersonalInsights({
    currentMonthExpenses,
    prevMonthExpenses,
    budgetLimits: limits,
    events,
    expenses,
    contributions,
    user,
  });

  // ── E. Handlers dépenses ──────────────────────────────────
  const handleSave = async () => {
    if (!form.detail.trim() || form.detail.trim().length < 2) {
      addToast("La description doit contenir au moins 2 caractères.", "warning"); return;
    }
    if (!form.unit_price || Number(form.unit_price) <= 0) {
      addToast("Le montant doit être supérieur à 0.", "warning"); return;
    }
    if (!personalEvent) { addToast("Événement personnel introuvable.", "error"); return; }

    setSaving(true);
    const paidBy = user?.user_metadata?.full_name || user?.email || "Moi";

    if (editingEx) {
      await updateExpense(editingEx.id, {
        category: form.category,
        sub: form.sub || "Autre",
        detail: form.detail.trim(),
        qty: 1,
        unit: Number(form.unit_price),
        paidBy,
        included: [],
        is_unpaid: false,
        comment: null,
      }, user.id, editingEx);
      addToast("Dépense modifiée.", "success");
    } else {
      await createExpense({
        eventId: personalEvent.id,
        category: form.category,
        sub: form.sub || "Autre",
        detail: form.detail.trim(),
        qty: 1,
        unit: Number(form.unit_price),
        paidBy,
        included: [],
        is_unpaid: false,
        comment: null,
      }, user.id);
      addToast("Dépense ajoutée.", "success");
    }

    await reload();
    setForm({ category: "Alimentation", sub: "Autre", detail: "", unit_price: "" });
    setEditingEx(null);
    setShowForm(false);
    setSaving(false);
  };

  const handleDelete = (ex) => {
    setConfirm({
      message: `Supprimer "${ex.detail}" ?`,
      onConfirm: async () => {
        await deleteExpense(ex, user.id);
        await reload();
        setConfirm(null);
        addToast("Dépense supprimée.", "info");
      },
      onCancel: () => setConfirm(null),
    });
  };

  const startEdit = (ex) => {
    setForm({ category: ex.category, sub: ex.sub_category || "Autre", detail: ex.detail, unit_price: String(ex.unit_price ?? "") });
    setEditingEx(ex);
    setShowForm(true);
  };

  // ── Navigation mois ───────────────────────────────────────
  const goMonth = useCallback((dir) => {
    setSelectedMonth(m => {
      const nm = m + dir;
      if (nm < 0) { setSelectedYear(y => y - 1); return 11; }
      if (nm > 11) { setSelectedYear(y => y + 1); return 0; }
      return nm;
    });
  }, [setSelectedMonth, setSelectedYear]);

  const isCurrentMonthSelected = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();
  const monthLabel = new Date(selectedYear, selectedMonth, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  if (initializing) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 200 }}>
      <Spinner />
    </div>
  );

  // ── G. LAYOUT ─────────────────────────────────────────────
  return (
    <div>
      {confirm && <ConfirmModal {...confirm} />}

      {/* ── En-tête ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>
            🧍 {t("personal_title") || "Mes dépenses personnelles"}
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: 12 }}>
            {t("personal_total") || "Suivi solo · mois par mois"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => { setShowBudgetModal(true); setShowOCR(false); setShowForm(false); }} style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }}>
            ⚙️ {t("personal_budgets") || "Budgets"}
          </button>
          <button onClick={() => { setShowOCR(v => !v); setShowForm(false); }} style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px" }}>
            📷 OCR
          </button>
          <button onClick={() => { setShowForm(v => !v); setShowOCR(false); setEditingEx(null); setForm({ category: "Alimentation", sub: "Autre", detail: "", unit_price: "" }); }} style={S.btnDark}>
            {showForm && !editingEx ? "× Fermer" : `+ ${t("personal_add") || "Ajouter"}`}
          </button>
        </div>
      </div>

      {/* ── OCR ── */}
      {showOCR && (
        <OCRCapture
          isMobile={isMobile}
          onFill={(data) => {
            setForm(f => ({
              ...f,
              unit_price: data.unit || f.unit_price,
              detail: data.detail || f.detail,
              category: PERSONAL_CATEGORIES[data.category] ? data.category : f.category,
              sub: PERSONAL_CATEGORIES[data.category] ? (data.sub || "Autre") : f.sub,
            }));
            setShowOCR(false);
            setShowForm(true);
          }}
          onClose={() => setShowOCR(false)}
          onManualEntry={() => { setShowOCR(false); setShowForm(true); }}
        />
      )}

      {/* ── Formulaire ── */}
      {showForm && (
        <div style={{ ...S.card, marginBottom: 20 }}>
          <div style={{ ...S.sectionTitle }}>{editingEx ? "✏️ Modifier la dépense" : "✚ Nouvelle dépense"}</div>

          {/* Sélecteur catégorie */}
          <div style={{ marginBottom: 14 }}>
            <label style={S.label}>Catégorie</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {Object.entries(PERSONAL_CATEGORIES).map(([cat, info]) => (
                <button key={cat} onClick={() => setForm(f => ({ ...f, category: cat, sub: "Autre" }))}
                  style={{ padding: "6px 12px", borderRadius: 20, border: `1.5px solid ${form.category === cat ? info.accent : "var(--border)"}`, background: form.category === cat ? info.color : "transparent", color: form.category === cat ? info.accent : "var(--text-muted)", fontSize: 12, fontWeight: form.category === cat ? 700 : 400, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{info.icon}</span> {cat}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={S.label}>Description <span style={{ color: "#C62828" }}>*</span></label>
              <input
                style={S.input}
                placeholder="Ex : Courses Lidl, Billet de train…"
                value={form.detail}
                onChange={e => setForm(f => ({ ...f, detail: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && handleSave()}
                autoFocus
              />
            </div>
            <div>
              <label style={S.label}>Montant ({sym}) <span style={{ color: "#C62828" }}>*</span></label>
              <input
                type="number"
                min="0"
                step="0.01"
                style={S.input}
                placeholder="0.00"
                value={form.unit_price}
                onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && handleSave()}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={{ ...S.btnDark, opacity: saving ? 0.5 : 1 }}>
              {saving ? "Enregistrement…" : editingEx ? "✓ Modifier" : "✓ Enregistrer"}
            </button>
            <button onClick={() => { setShowForm(false); setEditingEx(null); }} style={S.btnGhost}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── Sélecteur de mois ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => goMonth(-1)} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 16 }}>‹</button>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", minWidth: 140, textAlign: "center", textTransform: "capitalize" }}>{monthLabel}</span>
        <button onClick={() => goMonth(1)} style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 16 }}>›</button>
        {!isCurrentMonthSelected && (
          <button onClick={() => { setSelectedMonth(now.getMonth()); setSelectedYear(now.getFullYear()); }}
            style={{ ...S.btnGhost, fontSize: 12, padding: "6px 12px" }}>
            Aujourd'hui
          </button>
        )}
        {currentMonthExpenses.length > 0 && (
          <button onClick={() => exportPersonalPDF(selectedMonth, selectedYear, currentMonthExpenses, sym)}
            style={{ ...S.btnGhost, fontSize: 12, padding: "6px 12px", marginLeft: "auto" }}>
            📄 PDF
          </button>
        )}
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard
          label={t("personal_total") || "Total du mois"}
          value={fmt(totalMonth, sym)}
          sub={`${currentMonthExpenses.length} dépense${currentMonthExpenses.length > 1 ? "s" : ""}`}
          accent="#0F0F0F"
        />
        <StatCard
          label={t("personal_vs_prev") || "vs mois précédent"}
          value={variation !== null ? `${variation > 0 ? "+" : ""}${variation}%` : "—"}
          sub={totalPrev > 0 ? `${fmt(totalPrev, sym)} le mois dernier` : "Pas de données"}
          accent={variation !== null && variation > 10 ? "#C62828" : variation !== null && variation < 0 ? "#2E7D32" : "#F57F17"}
        />
        <StatCard
          label={t("personal_avg_day") || "Moyenne / jour"}
          value={fmt(avgPerDay, sym)}
          sub={`Jour ${daysElapsed}/${daysInMonth}`}
          accent="#1565C0"
        />
        <StatCard
          label={t("personal_top_cat") || "Top catégorie"}
          value={topCategory ? `${PERSONAL_CATEGORIES[topCategory[0]]?.icon || ""} ${topCategory[0]}` : "—"}
          sub={topCategory ? fmt(topCategory[1], sym) : "Aucune dépense"}
          accent="#6A1B9A"
        />
      </div>

      {/* ── Insights SplitSmart ── */}
      {insights.filter(ins => !dismissedInsights.includes(ins.id)).length > 0 && (
        <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
            ✦ {t("personal_insights") || "Analyses"}
          </div>
          {insights.filter(ins => !dismissedInsights.includes(ins.id)).map(ins => (
            <div key={ins.id} style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 10,
              background: ins.type === "danger" ? "#fff5f5" : ins.type === "warning" ? "#FFF8E1" : "var(--bg-secondary)",
              border: `1px solid ${ins.type === "danger" ? "#ffcdd2" : ins.type === "warning" ? "#FFE082" : "var(--border)"}`,
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{ins.icon}</span>
              <span style={{ flex: 1, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{ins.message}</span>
              <button onClick={() => setDismissedInsights(d => [...d, ins.id])}
                style={{ background: "none", border: "none", color: "var(--text-sub)", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0 }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Contenu principal ── */}
      {currentMonthExpenses.length === 0 ? (
        <EmptyState
          icon="🧍"
          title={t("personal_no_expenses") || "Aucune dépense ce mois"}
          subtitle="Commencez à enregistrer vos dépenses du mois."
          action={
            <button onClick={() => setShowForm(true)} style={S.btnDark}>
              + {t("personal_add") || "Ajouter une dépense"}
            </button>
          }
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 20 }}>

          {/* ── Colonne gauche : par catégorie ── */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 16, padding: 20, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
              🏷️ {t("personal_by_cat") || "Par catégorie"}
            </div>
            {byCat.map(([cat, amt]) => {
              const info = PERSONAL_CATEGORIES[cat] || { icon: "❓", color: "#f5f5f5", accent: "#757575" };
              const pct = totalMonth > 0 ? (amt / totalMonth) * 100 : 0;
              const limit = getLimitForCategory(cat);
              const limitPct = limit > 0 ? (amt / limit) * 100 : 0;
              const overBudget = limit > 0 && amt > limit;
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16, width: 22, flexShrink: 0 }}>{info.icon}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{cat}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{fmt(amt, sym)}</span>
                    <span style={{ fontSize: 11, color: "var(--text-sub)", minWidth: 32, textAlign: "right" }}>{Math.round(pct)}%</span>
                  </div>
                  <div style={{ background: "var(--border)", borderRadius: 6, height: 6, overflow: "hidden", marginBottom: 2 }}>
                    <div style={{ background: overBudget ? "#C62828" : info.accent, borderRadius: 6, height: 6, width: `${Math.min(pct, 100)}%`, transition: "width 0.5s" }} />
                  </div>
                  {limit > 0 && (
                    <div style={{ fontSize: 11, color: overBudget ? "#C62828" : "var(--text-sub)", marginTop: 2 }}>
                      {fmt(amt, sym)} / {fmt(limit, sym)} ({Math.round(limitPct)}%)
                      {overBudget && " ⚠️ Dépassé"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Colonne droite : liste dépenses ── */}
          <div style={{ background: "var(--bg-secondary)", borderRadius: 16, padding: 20, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
              🕐 {t("personal_list") || "Dépenses du mois"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 420, overflowY: "auto" }}>
              {[...currentMonthExpenses]
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .map((ex, i) => {
                  const info = PERSONAL_CATEGORIES[ex.category] || { icon: "❓", color: "#f5f5f5", accent: "#757575" };
                  const amt = ex.qty * (ex.unit_price ?? 0);
                  const d = new Date(ex.created_at).toLocaleDateString('fr-FR', { day: "2-digit", month: "2-digit" });
                  return (
                    <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < currentMonthExpenses.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: info.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                        {info.icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ex.detail}</div>
                        <div style={{ fontSize: 11, color: "var(--text-sub)" }}>{ex.category} · {d}</div>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>{fmt(amt, sym)}</span>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button onClick={() => startEdit(ex)} style={{ background: "#E3F2FD", border: "none", borderRadius: 7, padding: "4px 8px", cursor: "pointer", fontSize: 12, color: "#1565C0" }}>✏️</button>
                        <button onClick={() => handleDelete(ex)} style={{ background: "#fff5f5", border: "none", borderRadius: 7, padding: "4px 8px", cursor: "pointer", fontSize: 12, color: "#C62828" }}>🗑</button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal budgets ── */}
      {showBudgetModal && (
        <Modal title={`⚙️ ${t("personal_budgets") || "Budgets par catégorie"}`} onClose={() => setShowBudgetModal(false)}>
          <p style={{ fontSize: 12, color: "var(--text-sub)", marginBottom: 16 }}>
            {t("personal_budget_limit") || "Plafond mensuel"} — mettez 0 pour supprimer.
          </p>
          <div style={{ maxHeight: 440, overflowY: "auto" }}>
            {Object.entries(PERSONAL_CATEGORIES).map(([cat, info]) => (
              <BudgetRow
                key={`${cat}-${getLimitForCategory(cat)}`}
                cat={cat}
                info={info}
                currentLimit={getLimitForCategory(cat)}
                onSave={setLimit}
                sym={sym}
              />
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <button onClick={() => setShowBudgetModal(false)} style={{ ...S.btnDark, width: "100%" }}>
              ✓ Fermer
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
