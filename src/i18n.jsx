// src/i18n.jsx
// Configuration i18next — gestion globale des langues
import i18n from "i18next";
import { initReactI18next, useTranslation as useI18nTranslation } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { useState } from "react";

import fr from "../locales/fr.json";
import en from "../locales/en.json";
import es from "../locales/es.json";

// ─── Initialisation i18next ───────────────────────────────────
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: "fr",
    supportedLngs: ["fr", "en", "es"],
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "splitly_lang",
    },
    interpolation: { escapeValue: false },
  });

export default i18n;

// ─── Langues disponibles ──────────────────────────────────────
export const LANGUAGES = [
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "en", label: "English",  flag: "🇬🇧" },
  { code: "es", label: "Español",  flag: "🇪🇸" },
];

// ─── Hook useTranslation (wrapper) ───────────────────────────
// Utilise useTranslation de react-i18next + expose lang/setLang
export function useTranslation() {
  const { t, i18n: i18nInstance } = useI18nTranslation();
  const lang = i18nInstance.language?.slice(0, 2) || "fr";

  const setLang = (newLang) => {
    i18nInstance.changeLanguage(newLang);
  };

  return { t, lang, setLang };
}

// ─── LanguageMenu — dropdown professionnel ────────────────────
export function LanguageMenu({ lang, setLang, dark = false }) {
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0];
  const border = dark ? "#2a2a2a" : "#e0e0e0";
  const textColor = dark ? "#fff" : "#333";

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px", borderRadius: 9, cursor: "pointer",
          background: dark ? "rgba(255,255,255,0.06)" : "#f5f5f5",
          border: `1px solid ${border}`,
          color: textColor, fontSize: 12, fontWeight: 600,
          fontFamily: "inherit", width: "100%", transition: "all 0.15s",
        }}
      >
        <span style={{ fontSize: 16 }}>{current.flag}</span>
        <span style={{ flex: 1, textAlign: "left" }}>{current.label}</span>
        <span style={{
          fontSize: 10, opacity: 0.5, display: "inline-block",
          transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)"
        }}>▼</span>
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 998 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0,
            background: dark ? "#1e1e1e" : "#fff",
            border: `1px solid ${border}`, borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            zIndex: 999, overflow: "hidden",
          }}>
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", width: "100%", border: "none",
                  background: l.code === lang ? (dark ? "#252525" : "#f0f0f0") : "transparent",
                  color: l.code === lang ? (dark ? "#fff" : "#0F0F0F") : (dark ? "#aaa" : "#555"),
                  fontSize: 13, fontWeight: l.code === lang ? 700 : 400,
                  cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                }}
              >
                <span style={{ fontSize: 18 }}>{l.flag}</span>
                <span style={{ flex: 1 }}>{l.label}</span>
                {l.code === lang && <span style={{ color: "#2E7D32" }}>✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── LanguageSwitcher — boutons inline (landing page) ─────────
export function LanguageSwitcher({ lang, setLang, dark = false }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      {LANGUAGES.map(l => (
        <button
          key={l.code}
          onClick={() => setLang(l.code)}
          title={l.label}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: 8, cursor: "pointer",
            background: lang === l.code
              ? (dark ? "#fff" : "#0F0F0F")
              : (dark ? "rgba(255,255,255,0.06)" : "#f5f5f5"),
            color: lang === l.code
              ? (dark ? "#0F0F0F" : "#fff")
              : (dark ? "rgba(255,255,255,0.6)" : "#555"),
            border: `1px solid ${lang === l.code
              ? (dark ? "#fff" : "#0F0F0F")
              : (dark ? "rgba(255,255,255,0.12)" : "#e0e0e0")}`,
            fontSize: 12, fontWeight: lang === l.code ? 700 : 500,
            transition: "all 0.15s", fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 13 }}>{l.flag}</span>
          <span>{l.code.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}
