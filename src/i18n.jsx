// src/i18n.jsx
// Configuration i18next — gestion globale des langues
import i18n from "i18next";
import { initReactI18next, useTranslation as useI18nTranslation } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { useState, useEffect, useRef } from "react";

import fr from "../locales/fr.json";
import en from "../locales/en.json";
import es from "../locales/es.json";
import pt from "../locales/pt.json";
import ar from "../locales/ar.json";

// ─── Initialisation i18next ───────────────────────────────────
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
      es: { translation: es },
      pt: { translation: pt },
      ar: { translation: ar },
    },
    fallbackLng: "fr",
    supportedLngs: ["fr", "en", "es", "pt", "ar"],
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
  { code: "fr", label: "Français",  flag: "🇫🇷", rtl: false },
  { code: "en", label: "English",   flag: "🇬🇧", rtl: false },
  { code: "es", label: "Español",   flag: "🇪🇸", rtl: false },
  { code: "pt", label: "Português", flag: "🇵🇹", rtl: false },
  { code: "ar", label: "العربية",   flag: "🇸🇦", rtl: true  },
];

// ─── Hook useTranslation (wrapper) ───────────────────────────
export function useTranslation() {
  const { t, i18n: i18nInstance } = useI18nTranslation();
  const lang = i18nInstance.language?.slice(0, 2) || "fr";
  const isRTL = LANGUAGES.find(l => l.code === lang)?.rtl || false;

  const setLang = (newLang) => {
    i18nInstance.changeLanguage(newLang);
  };

  // Appliquer RTL/LTR sur le document automatiquement
  useEffect(() => {
    document.documentElement.setAttribute("dir", isRTL ? "rtl" : "ltr");
    document.documentElement.setAttribute("lang", lang);
  }, [lang, isRTL]);

  return { t, lang, setLang, isRTL };
}

// ─── LanguageMenu — dropdown professionnel ────────────────────
export function LanguageMenu({ lang, setLang, dark = false, dropUp = true }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);
  const current = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0];
  const border = dark ? "#2a2a2a" : "#e0e0e0";
  const textColor = dark ? "#fff" : "#333";

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 6,
        bottom: window.innerHeight - rect.top + 6,
        left: rect.left,
        width: rect.width,
      });
    }
    setOpen(v => !v);
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={handleToggle}
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
          transition: "transform 0.2s",
          transform: open
            ? (dropUp ? "rotate(0deg)" : "rotate(180deg)")
            : (dropUp ? "rotate(180deg)" : "rotate(0deg)"),
        }}>▼</span>
      </button>

      {open && coords && (
        <>
          {/* Overlay pour fermer */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          {/* Dropdown en position:fixed — échappe tout overflow:hidden */}
          <div style={{
            position: "fixed",
            ...(dropUp
              ? { bottom: coords.bottom }
              : { top: coords.top }),
            left: coords.left,
            width: coords.width,
            background: dark ? "#1e1e1e" : "#fff",
            border: `1px solid ${border}`,
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
            zIndex: 9999,
            overflow: "hidden",
          }}>
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                onClick={() => { setLang(l.code); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", width: "100%", border: "none",
                  background: l.code === lang
                    ? (dark ? "#252525" : "#f0f0f0")
                    : "transparent",
                  color: l.code === lang
                    ? (dark ? "#fff" : "#0F0F0F")
                    : (dark ? "#aaa" : "#555"),
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
