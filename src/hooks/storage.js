// src/hooks/storage.js
// Constantes et helpers localStorage

export const TEMPLATES_KEY = "splitly_templates";
export const ONBOARDING_KEY = "splitly_onboarded";

export function getTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]"); } catch { return []; }
}

export function saveTemplates(templates) {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates)); } catch {}
}
