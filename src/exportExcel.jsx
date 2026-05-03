// src/exportExcel.js
// Export Excel professionnel avec ExcelJS — même structure que les PDFs SplitLy
// Feuilles : Résumé | Charges | Soldes (Split) ou Cotisations (Budget)

import ExcelJS from "exceljs";

// ── Couleurs et styles ────────────────────────────────────────
const COLORS = {
  headerBg:    "FF0F0F0F", // noir SplitLy
  headerFg:    "FFFFFFFF", // blanc
  subHeaderBg: "FF2D2D2D", // gris foncé
  subHeaderFg: "FFFFFFFF",
  rowAlt:      "FFF5F5F5", // ligne alternée gris clair
  rowWhite:    "FFFFFFFF",
  accentBlue:  "FF1565C0",
  accentGreen: "FF2E7D32",
  accentRed:   "FFC62828",
  accentOrange:"FFF57F17",
  accentPurple:"FF6A1B9A",
  border:      "FFDDDDDD",
  totalBg:     "FFEEEEEE",
  paidBg:      "FFE8F5E9",
  unpaidBg:    "FFFFEBEE",
};

function borderAll(color = COLORS.border) {
  const side = { style: "thin", color: { argb: color } };
  return { top: side, left: side, bottom: side, right: side };
}

function applyHeader(cell, text, bgColor = COLORS.headerBg, fgColor = COLORS.headerFg) {
  cell.value = text;
  cell.font = { bold: true, color: { argb: fgColor }, size: 11, name: "Arial" };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  cell.border = borderAll(COLORS.headerBg);
}

function applyCell(cell, value, options = {}) {
  cell.value = value;
  cell.font = { size: 10, name: "Arial", bold: options.bold || false, color: { argb: options.color || "FF333333" } };
  cell.alignment = { vertical: "middle", horizontal: options.align || "left", wrapText: false };
  if (options.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: options.bg } };
  if (options.border !== false) cell.border = borderAll();
  if (options.numFmt) cell.numFmt = options.numFmt;
}

// ── Export Split — Charges + Soldes ──────────────────────────
export async function exportSplitExcel({ ev, expenses, contributions, participants, sym }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SplitLy";
  wb.created = new Date();

  // ── Feuille 1 : Résumé ─────────────────────────────────────
  const sheetSummary = wb.addWorksheet("Résumé", { tabColor: { argb: COLORS.headerBg.slice(2) } });
  sheetSummary.columns = [
    { key: "label", width: 28 },
    { key: "value", width: 30 },
  ];
  [
    ["📋 Événement", ev.name],
    ["📅 Date", ev.date],
    ["💱 Devise", sym],
    ["👥 Participants", participants.length],
    ["🧾 Charges", expenses.length],
    ["💰 Total dépenses", expenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0)],
    ["🕐 Généré le", new Date().toLocaleString("fr-FR")],
  ].forEach(([label, value], i) => {
    const row = sheetSummary.addRow({ label, value });
    row.height = 22;
    applyCell(row.getCell(1), label, { bold: true, bg: i % 2 === 0 ? COLORS.rowAlt : COLORS.rowWhite });
    const isAmount = label.includes("Total");
    applyCell(row.getCell(2), value, {
      bg: i % 2 === 0 ? COLORS.rowAlt : COLORS.rowWhite,
      numFmt: isAmount ? `#,##0.00 "${sym}"` : undefined,
      color: isAmount ? COLORS.accentGreen.slice(2) : "FF333333",
      bold: isAmount,
    });
  });
  // Titre en haut
  sheetSummary.spliceRows(1, 0, []);
  const titleRow = sheetSummary.getRow(1);
  titleRow.height = 36;
  sheetSummary.mergeCells("A1:B1");
  applyHeader(sheetSummary.getCell("A1"), `SplitLy — ${ev.name}`, COLORS.headerBg, COLORS.headerFg);
  sheetSummary.getCell("A1").font = { bold: true, color: { argb: COLORS.headerFg }, size: 14, name: "Arial" };

  // ── Feuille 2 : Charges ────────────────────────────────────
  const sheetExp = wb.addWorksheet("Charges", { tabColor: { argb: "001565C0" } });
  sheetExp.columns = [
    { key: "cat",   width: 16 },
    { key: "sub",   width: 18 },
    { key: "desc",  width: 28 },
    { key: "qty",   width: 10 },
    { key: "unit",  width: 14 },
    { key: "total", width: 16 },
    { key: "paidBy",width: 18 },
    { key: "parts", width: 30 },
    { key: "comment",width: 24 },
  ];

  // En-tête feuille Charges
  sheetExp.addRow([]);
  const expTitleRow = sheetExp.addRow([`Charges — ${ev.name}`, "", "", "", "", "", "", "", ""]);
  sheetExp.mergeCells(`A2:I2`);
  expTitleRow.height = 32;
  applyHeader(sheetExp.getCell("A2"), `Charges — ${ev.name}`);

  const expHeaders = sheetExp.addRow(["Catégorie", "Sous-catégorie", "Description", "Qté", `Prix unit. (${sym})`, `Total (${sym})`, "Payé par", "Participants", "Commentaire"]);
  expHeaders.height = 24;
  expHeaders.eachCell(cell => applyHeader(cell, cell.value, COLORS.subHeaderBg));

  let expTotal = 0;
  expenses.forEach((ex, i) => {
    const total = ex.qty * (ex.unit_price ?? 0);
    expTotal += total;
    const isUnpaid = ex.is_unpaid;
    const bg = isUnpaid ? COLORS.unpaidBg : (i % 2 === 0 ? COLORS.rowAlt : COLORS.rowWhite);
    const row = sheetExp.addRow({
      cat:    ex.category || "",
      sub:    ex.sub_category || "",
      desc:   ex.detail || "",
      qty:    ex.qty,
      unit:   ex.unit_price ?? 0,
      total,
      paidBy: isUnpaid ? "⏳ Non réglée" : (ex.paid_by || ""),
      parts:  (ex.included || []).join(", "),
      comment:ex.comment || "",
    });
    row.height = 20;
    row.eachCell((cell, colNum) => {
      const isNum = [4, 5, 6].includes(colNum);
      applyCell(cell, cell.value, {
        bg,
        align: isNum ? "right" : "left",
        numFmt: isNum && colNum !== 4 ? `#,##0.00` : undefined,
        color: isUnpaid ? COLORS.accentOrange.slice(2) : "FF333333",
      });
    });
  });

  // Ligne total
  const totalRow = sheetExp.addRow(["", "", "", "", "TOTAL", expTotal, "", "", ""]);
  totalRow.height = 24;
  applyCell(totalRow.getCell(5), "TOTAL", { bold: true, bg: COLORS.totalBg, align: "right" });
  applyCell(totalRow.getCell(6), expTotal, { bold: true, bg: COLORS.totalBg, align: "right", numFmt: `#,##0.00`, color: COLORS.accentGreen.slice(2) });

  // ── Feuille 3 : Soldes ─────────────────────────────────────
  const sheetBal = wb.addWorksheet("Soldes", { tabColor: { argb: "002E7D32" } });
  sheetBal.columns = [
    { key: "name",   width: 22 },
    { key: "owed",   width: 18 },
    { key: "paid",   width: 18 },
    { key: "balance",width: 18 },
    { key: "status", width: 20 },
  ];

  sheetBal.addRow([]);
  const balTitleRow = sheetBal.addRow([`Soldes — ${ev.name}`, "", "", "", ""]);
  sheetBal.mergeCells("A2:E2");
  balTitleRow.height = 32;
  applyHeader(sheetBal.getCell("A2"), `Soldes — ${ev.name}`);

  const balHeaders = sheetBal.addRow(["Participant", `Part due (${sym})`, `Versé (${sym})`, `Solde (${sym})`, "Statut"]);
  balHeaders.height = 24;
  balHeaders.eachCell(cell => applyHeader(cell, cell.value, COLORS.subHeaderBg));

  const contribMap = {};
  Object.values(contributions || {}).forEach(evC => {
    if (typeof evC === "object" && !Array.isArray(evC)) {
      Object.entries(evC).forEach(([p, a]) => { contribMap[p] = (contribMap[p] || 0) + a; });
    }
  });

  participants.forEach((p, i) => {
    // Calculer la part due
    const owed = expenses.reduce((sum, ex) => {
      if (!ex.included || !ex.included.includes(p)) return sum;
      const total = ex.qty * (ex.unit_price ?? 0);
      return sum + total / (ex.included.length || 1);
    }, 0);
    const paid = contribMap[p] || 0;
    const balance = paid - owed;
    const isSettled = Math.abs(balance) <= 1;
    const isPositive = balance > 1;
    const bg = isSettled ? COLORS.paidBg : (i % 2 === 0 ? COLORS.rowAlt : COLORS.rowWhite);
    const statusLabel = isSettled ? "✓ Soldé" : isPositive ? "↑ À recevoir" : "↓ Doit rembourser";
    const statusColor = isSettled ? COLORS.accentGreen.slice(2) : isPositive ? COLORS.accentBlue.slice(2) : COLORS.accentRed.slice(2);

    const row = sheetBal.addRow({ name: p, owed, paid, balance, status: statusLabel });
    row.height = 22;
    applyCell(row.getCell(1), p, { bg, bold: true });
    applyCell(row.getCell(2), owed, { bg, align: "right", numFmt: "#,##0.00" });
    applyCell(row.getCell(3), paid, { bg, align: "right", numFmt: "#,##0.00" });
    applyCell(row.getCell(4), balance, { bg, align: "right", numFmt: "#,##0.00", bold: true, color: statusColor });
    applyCell(row.getCell(5), statusLabel, { bg, color: statusColor, bold: isSettled });
  });

  // ── Téléchargement ─────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const fileName = `SplitLy_${ev.name.replace(/\s+/g, "_")}_${ev.date}.xlsx`;
  await downloadBlob(blob, fileName);
}

// ── Export Budget — Charges + Cotisations ────────────────────
export async function exportBudgetExcel({ ev, expenses, cotisations, participants, sym }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SplitLy";
  wb.created = new Date();

  // ── Feuille 1 : Résumé Budget ──────────────────────────────
  const sheetSummary = wb.addWorksheet("Résumé", { tabColor: { argb: "00F57F17" } });
  sheetSummary.columns = [{ key: "label", width: 28 }, { key: "value", width: 30 }];

  const totalDepenses = expenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const totalCotisations = (cotisations || []).filter(c => c.statut === "paye").reduce((s, c) => s + c.montant, 0);
  const cotisationCible = ev.cotisation_cible || 0;
  const pctCollecte = cotisationCible * participants.length > 0
    ? Math.min((totalCotisations / (cotisationCible * participants.length)) * 100, 100).toFixed(1)
    : "—";

  [
    ["🏦 Événement Budget", ev.name],
    ["📅 Date", ev.date],
    ["💱 Devise", sym],
    ["👥 Participants", participants.length],
    ["🎯 Cotisation cible/pers.", cotisationCible > 0 ? cotisationCible : "Libre"],
    ["💰 Total cotisations collectées", totalCotisations],
    ["🧾 Total dépenses", totalDepenses],
    ["📊 Progression collecte", cotisationCible > 0 ? `${pctCollecte}%` : "—"],
    ["🕐 Généré le", new Date().toLocaleString("fr-FR")],
  ].forEach(([label, value], i) => {
    const row = sheetSummary.addRow({ label, value });
    row.height = 22;
    applyCell(row.getCell(1), label, { bold: true, bg: i % 2 === 0 ? COLORS.rowAlt : COLORS.rowWhite });
    const isAmount = label.includes("Total") || label.includes("cible");
    applyCell(row.getCell(2), value, {
      bg: i % 2 === 0 ? COLORS.rowAlt : COLORS.rowWhite,
      numFmt: isAmount && typeof value === "number" ? `#,##0.00 "${sym}"` : undefined,
      color: isAmount ? COLORS.accentGreen.slice(2) : "FF333333",
      bold: isAmount,
    });
  });

  sheetSummary.spliceRows(1, 0, []);
  const titleRow = sheetSummary.getRow(1);
  titleRow.height = 36;
  sheetSummary.mergeCells("A1:B1");
  applyHeader(sheetSummary.getCell("A1"), `SplitLy — ${ev.name}`, "FFEF9F27", COLORS.headerFg);
  sheetSummary.getCell("A1").font = { bold: true, color: { argb: COLORS.headerFg }, size: 14, name: "Arial" };

  // ── Feuille 2 : Cotisations ────────────────────────────────
  const sheetCot = wb.addWorksheet("Cotisations", { tabColor: { argb: "006A1B9A" } });
  sheetCot.columns = [
    { key: "name",   width: 22 },
    { key: "montant",width: 18 },
    { key: "forme",  width: 16 },
    { key: "statut", width: 16 },
    { key: "desc",   width: 28 },
  ];

  sheetCot.addRow([]);
  sheetCot.mergeCells("A2:E2");
  const cotTitleRow = sheetCot.getRow(2);
  cotTitleRow.height = 32;
  applyHeader(sheetCot.getCell("A2"), `Cotisations — ${ev.name}`, COLORS.headerBg);

  const cotHeaders = sheetCot.addRow(["Participant", `Montant (${sym})`, "Forme", "Statut", "Description"]);
  cotHeaders.height = 24;
  cotHeaders.eachCell(cell => applyHeader(cell, cell.value, COLORS.subHeaderBg));

  let totalPaye = 0;
  (cotisations || []).forEach((cot, i) => {
    if (cot.statut === "paye") totalPaye += cot.montant;
    const isPaid = cot.statut === "paye";
    const bg = isPaid ? COLORS.paidBg : (i % 2 === 0 ? COLORS.rowAlt : COLORS.rowWhite);
    const row = sheetCot.addRow({
      name:    cot.participant_name,
      montant: cot.montant,
      forme:   cot.forme === "nature" ? "🌿 Nature" : "💵 Espèces",
      statut:  isPaid ? "✓ Payé" : "✗ Impayé",
      desc:    cot.description || "",
    });
    row.height = 20;
    applyCell(row.getCell(1), cot.participant_name, { bg, bold: true });
    applyCell(row.getCell(2), cot.montant, { bg, align: "right", numFmt: "#,##0.00", color: isPaid ? COLORS.accentGreen.slice(2) : COLORS.accentRed.slice(2), bold: true });
    applyCell(row.getCell(3), row.getCell(3).value, { bg });
    applyCell(row.getCell(4), row.getCell(4).value, { bg, bold: isPaid, color: isPaid ? COLORS.accentGreen.slice(2) : COLORS.accentRed.slice(2) });
    applyCell(row.getCell(5), cot.description || "", { bg });
  });

  const totRow = sheetCot.addRow(["", totalPaye, "TOTAL COLLECTÉ", "", ""]);
  totRow.height = 24;
  applyCell(totRow.getCell(2), totalPaye, { bold: true, bg: COLORS.totalBg, align: "right", numFmt: "#,##0.00", color: COLORS.accentGreen.slice(2) });
  applyCell(totRow.getCell(3), "TOTAL COLLECTÉ", { bold: true, bg: COLORS.totalBg });

  // ── Feuille 3 : Dépenses Budget ────────────────────────────
  const sheetDep = wb.addWorksheet("Dépenses", { tabColor: { argb: "001565C0" } });
  sheetDep.columns = [
    { key: "cat",    width: 16 },
    { key: "sub",    width: 18 },
    { key: "desc",   width: 28 },
    { key: "qty",    width: 10 },
    { key: "unit",   width: 14 },
    { key: "total",  width: 16 },
    { key: "resp",   width: 20 },
    { key: "comment",width: 24 },
  ];

  sheetDep.addRow([]);
  sheetDep.mergeCells("A2:H2");
  const depTitleRow = sheetDep.getRow(2);
  depTitleRow.height = 32;
  applyHeader(sheetDep.getCell("A2"), `Dépenses — ${ev.name}`);

  const depHeaders = sheetDep.addRow(["Catégorie", "Sous-catégorie", "Description", "Qté", `Prix unit. (${sym})`, `Total (${sym})`, "Responsable", "Commentaire"]);
  depHeaders.height = 24;
  depHeaders.eachCell(cell => applyHeader(cell, cell.value, COLORS.subHeaderBg));

  let depTotal = 0;
  expenses.forEach((ex, i) => {
    const total = ex.qty * (ex.unit_price ?? 0);
    depTotal += total;
    const bg = i % 2 === 0 ? COLORS.rowAlt : COLORS.rowWhite;
    const row = sheetDep.addRow({
      cat:    ex.category || "",
      sub:    ex.sub_category || "",
      desc:   ex.detail || "",
      qty:    ex.qty,
      unit:   ex.unit_price ?? 0,
      total,
      resp:   ex.paid_by || "",
      comment:ex.comment || "",
    });
    row.height = 20;
    row.eachCell((cell, colNum) => {
      const isNum = [4, 5, 6].includes(colNum);
      applyCell(cell, cell.value, { bg, align: isNum ? "right" : "left", numFmt: isNum && colNum !== 4 ? "#,##0.00" : undefined });
    });
  });

  const depTotRow = sheetDep.addRow(["", "", "", "", "TOTAL", depTotal, "", ""]);
  depTotRow.height = 24;
  applyCell(depTotRow.getCell(5), "TOTAL", { bold: true, bg: COLORS.totalBg, align: "right" });
  applyCell(depTotRow.getCell(6), depTotal, { bold: true, bg: COLORS.totalBg, align: "right", numFmt: "#,##0.00", color: COLORS.accentGreen.slice(2) });

  // ── Téléchargement ─────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const fileName = `SplitLy_Budget_${ev.name.replace(/\s+/g, "_")}_${ev.date}.xlsx`;
  await downloadBlob(blob, fileName);
}

// ── Téléchargement avec fallback iOS ─────────────────────────
async function downloadBlob(blob, fileName) {
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, { type: blob.type })] })) {
    const file = new File([blob], fileName, { type: blob.type });
    await navigator.share({ files: [file], title: `Export SplitLy — ${fileName}` });
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
