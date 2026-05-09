// src/utils.js

import { AVATAR_STORAGE_KEY } from "./constants.js";

// ─── FORMATAGE ────────────────────────────────────────────────

export const currencySymbol = (c) => c?.split(" ")[1] || "€";

// Séparateur de milliers + 2 décimales
export function fmt(amount, sym = "") {
  const n = Number(amount) || 0;
  const parts = n.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0"); // espace insécable
  return sym ? `${parts.join(".")} ${sym}` : parts.join(".");
}

// ─── CALCULS MÉTIER ───────────────────────────────────────────

export function computeOwed(expenses, person) {
  return expenses.reduce((sum, ex) => {
    const inc = ex.included || [];
    if (inc.length === 0 || !inc.includes(person)) return sum;
    return sum + (ex.qty * (ex.unit_price ?? 0)) / inc.length;
  }, 0);
}

export function computeNetBalance(expenses, contributions, person) {
  return (contributions[person] || 0) - computeOwed(expenses, person);
}

// Soldé strictement = écart ≤ 1 unité de monnaie
export const isSettled = (net) => Math.abs(net) <= 1;
// Soldé exactement = écart = 0 (pour les messages)
export const isExactlySettled = (net) => Math.abs(net) < 0.01;

// Statut solde lisible
export function settleStatus(net, hasCharges) {
  if (!hasCharges) return { label: "—", color: "#aaa", bg: "#f5f5f5" };
  if (isExactlySettled(net)) return { label: "✓ Soldé", color: "#2E7D32", bg: "#E8F5E9" };
  if (isSettled(net)) return { label: "≈ Quasi soldé", color: "#2E7D32", bg: "#E8F5E9" };
  if (net > 0) return { label: `+${fmt(net)} à recevoir`, color: "#1565C0", bg: "#E3F2FD" };
  return { label: `${fmt(net)} à payer`, color: "#C62828", bg: "#fff5f5" };
}

// Validation montant
export function validateAmount(qty, unit) {
  const q = Number(qty);
  const u = Number(unit);
  if (!qty || q <= 0) return "La quantité doit être supérieure à 0.";
  if (!Number.isInteger(q)) return "La quantité doit être un nombre entier.";
  if (q > 10000) return "La quantité ne peut pas dépasser 10 000.";
  if (!unit || u <= 0) return "Le prix unitaire doit être supérieur à 0.";
  if (u > 99999) return "Le prix unitaire ne peut pas dépasser 99 999.";
  if (q * u > 99999) return "Le montant total ne peut pas dépasser 99 999 (5 chiffres).";
  return null;
}

export function computeTransactions(expenses, contributions, participants) {
  const nets = {};
  participants.forEach(p => { nets[p] = computeNetBalance(expenses, contributions, p); });
  const creditors = [], debtors = [];
  Object.entries(nets).forEach(([p, v]) => {
    if (v > 1) creditors.push({ p, v });
    else if (v < -1) debtors.push({ p, v: -v });
  });
  creditors.sort((a, b) => b.v - a.v);
  debtors.sort((a, b) => b.v - a.v);
  const txns = [];
  let i = 0, j = 0;
  while (i < creditors.length && j < debtors.length) {
    const amount = Math.min(creditors[i].v, debtors[j].v);
    if (amount > 0.01) txns.push({ from: debtors[j].p, to: creditors[i].p, amount });
    creditors[i].v -= amount; debtors[j].v -= amount;
    if (creditors[i].v <= 0.01) i++;
    if (debtors[j].v <= 0.01) j++;
  }
  return txns;
}

// ─── AVATARS ──────────────────────────────────────────────────

export function getAvatarMap() {
  try { return JSON.parse(localStorage.getItem(AVATAR_STORAGE_KEY) || "{}"); } catch { return {}; }
}

export function saveAvatarEmoji(name, emoji) {
  const map = getAvatarMap();
  if (emoji === null) { delete map[name]; } else { map[name] = emoji; }
  try { localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(map)); } catch {}
}
