import { useState, useEffect } from "react";
import { useTranslation, LanguageSwitcher } from "./i18n.js";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
}

export default function LandingPage({ onSignIn, onSignUp, onGuest }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const { t, lang, setLang } = useTranslation();

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  const features = [
    { icon: "🎊", title: "Événements partagés", desc: "Créez un événement, ajoutez vos amis et gérez toutes les dépenses en un seul endroit." },
    { icon: "⚖️", title: "Répartition intelligente", desc: "Choisissez qui partage chaque charge. Bob ne boit pas d'alcool ? Excluez-le en un clic." },
    { icon: "💸", title: "Soldes en temps réel", desc: "Visualisez instantanément qui doit quoi à qui. Les calculs sont automatiques et précis." },
    { icon: "🔒", title: "Bouclage d'événement", desc: "Une fois tout soldé, bouclez l'événement pour figer les données définitivement." },
    { icon: "📊", title: "Analyses détaillées", desc: "Suivez votre budget par catégorie, par événement et par participant." },
    { icon: "👥", title: "Accès invités", desc: "Invitez vos amis à consulter les dépenses via un code sécurisé sans création de compte." },
    { icon: "📄", title: "Export PDF", desc: "Générez un récapitulatif PDF daté de toutes les dépenses et contributions." },
    { icon: "🌍", title: "Multi-devises", desc: "EUR, USD, FCFA, MAD… Choisissez la devise de votre événement parmi les plus utilisées." },
  ];

  const steps = [
    { num: "01", title: "Créez l'événement", desc: "Donnez un nom à votre sortie, choisissez une date, une devise et ajoutez les participants.", icon: "🎊" },
    { num: "02", title: "Enregistrez les dépenses", desc: "Ajoutez chaque charge avec sa catégorie, le payeur et les personnes concernées.", icon: "🧾" },
    { num: "03", title: "Soldez et bouclez", desc: "L'app calcule automatiquement qui doit combien. Soldez en un clic et bouclezez quand tout est réglé.", icon: "✅" },
  ];

  const useCases = [
    { emoji: "🍽️", title: "Restos & sorties", desc: "Qui a payé quoi ? Qui partage le dessert ? Fini les calculs à la main sur une serviette." },
    { emoji: "✈️", title: "Voyages en groupe", desc: "Airbnb, voiture, activités... Gérez des dizaines de dépenses sur plusieurs jours facilement." },
    { emoji: "🏠", title: "Colocations", desc: "Loyer, courses, factures — répartissez équitablement les charges mensuelles entre colocataires." },
    { emoji: "🎉", title: "Fêtes & célébrations", desc: "Organisez un anniversaire ou une soirée sans vous prendre la tête avec les remboursements." },
    { emoji: "💼", title: "Dépenses pro & équipes", desc: "Réunions, déplacements, fournitures — suivez et partagez les frais professionnels en toute transparence." },
    { emoji: "🎓", title: "Vie étudiante", desc: "Coloc, sorties, repas entre étudiants — gérez votre budget collectif sans prise de tête." },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#1a1a1a", overflowX: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .btn-secondary:hover { background: #f0f0f0 !important; transform: translateY(-1px); }
        .btn-ghost:hover { background: rgba(255,255,255,0.12) !important; }
        .feature-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.1); }
        .use-card:hover { transform: translateY(-3px); }
        .btn-primary, .btn-secondary, .btn-ghost, .feature-card, .use-card { transition: all 0.2s ease; }
        .nav-link:hover { color: #fff !important; }
      `}</style>

      {/* ─── NAVBAR ─────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
        background: scrolled ? "rgba(255,255,255,0.96)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(0,0,0,0.08)" : "none",
        padding: isMobile ? "0 16px" : "0 32px",
        height: 60,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        transition: "all 0.3s ease",
      }}>
        {/* Logo */}
        <div style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: isMobile ? 20 : 22,
          fontWeight: 700,
          color: scrolled ? "#0F0F0F" : "#fff",
          letterSpacing: -0.5,
          cursor: "default",
        }}>
          SplitLy
        </div>

        {/* Desktop nav */}
        {!isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <a href="#features" className="nav-link" style={{ fontSize: 14, color: scrolled ? "#555" : "rgba(255,255,255,0.8)", textDecoration: "none", padding: "8px 12px", borderRadius: 8, fontWeight: 500 }}>{t("land_features")}</a>
            <a href="#how" className="nav-link" style={{ fontSize: 14, color: scrolled ? "#555" : "rgba(255,255,255,0.8)", textDecoration: "none", padding: "8px 12px", borderRadius: 8, fontWeight: 500 }}>{t("land_how")}</a>
            <a href="#usecases" className="nav-link" style={{ fontSize: 14, color: scrolled ? "#555" : "rgba(255,255,255,0.8)", textDecoration: "none", padding: "8px 12px", borderRadius: 8, fontWeight: 500 }}>{t("land_usecases")}</a>
            <div style={{ width: 1, height: 18, background: scrolled ? "#e0e0e0" : "rgba(255,255,255,0.25)", margin: "0 4px" }} />
            <LanguageSwitcher lang={lang} setLang={setLang} dark={!scrolled} />
            <div style={{ width: 1, height: 18, background: scrolled ? "#e0e0e0" : "rgba(255,255,255,0.25)", margin: "0 4px" }} />
            <button onClick={onGuest} className="btn-ghost" style={{ fontSize: 13, color: scrolled ? "#555" : "rgba(255,255,255,0.85)", background: "transparent", border: `1px solid ${scrolled ? "#ddd" : "rgba(255,255,255,0.25)"}`, borderRadius: 10, padding: "7px 14px", cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
              {t("land_guest_access")}
            </button>
            <button onClick={onSignIn} className="btn-secondary" style={{ fontSize: 13, color: "#0F0F0F", background: scrolled ? "#f5f5f5" : "rgba(255,255,255,0.92)", border: "none", borderRadius: 10, padding: "7px 14px", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
              {t("land_signin")}
            </button>
            <button onClick={onSignUp} className="btn-primary" style={{ fontSize: 13, color: "#fff", background: "#0F0F0F", border: "none", borderRadius: 10, padding: "8px 18px", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
              {t("land_signup")} →
            </button>
          </div>
        )}

        {/* Mobile — hamburger uniquement */}
        {isMobile && (
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 8, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {menuOpen
              ? <span style={{ fontSize: 26, color: scrolled ? "#0F0F0F" : "#fff", lineHeight: 1 }}>✕</span>
              : <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ width: 24, height: 2, background: scrolled ? "#0F0F0F" : "#fff", borderRadius: 2 }} />
                  <div style={{ width: 18, height: 2, background: scrolled ? "#0F0F0F" : "#fff", borderRadius: 2 }} />
                  <div style={{ width: 24, height: 2, background: scrolled ? "#0F0F0F" : "#fff", borderRadius: 2 }} />
                </div>
            }
          </button>
        )}
      </nav>

      {/* Mobile drawer menu */}
      {isMobile && menuOpen && (
        <div style={{
          position: "fixed", top: 60, left: 0, right: 0, zIndex: 190,
          background: "#0F0F0F",
          padding: "20px 24px 32px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          animation: "slideDown 0.2s ease",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
            {[
              { href: "#features", label: t("land_features") },
              { href: "#how", label: t("land_how") },
              { href: "#usecases", label: t("land_usecases") },
            ].map(link => (
              <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}
                style={{ fontSize: 16, color: "rgba(255,255,255,0.8)", textDecoration: "none", fontWeight: 600, padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {link.label}
              </a>
            ))}
          </div>
          <div style={{ marginBottom: 16 }}>
            <LanguageSwitcher lang={lang} setLang={setLang} dark={true} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={() => { setMenuOpen(false); onGuest(); }}
              style={{ padding: "13px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {t("land_guest_access")}
            </button>
            <button onClick={() => { setMenuOpen(false); onSignIn(); }}
              style={{ padding: "13px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {t("land_signin")}
            </button>
            <button onClick={() => { setMenuOpen(false); onSignUp(); }}
              style={{ padding: "13px", borderRadius: 12, border: "none", background: "#fff", color: "#0F0F0F", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              {t("land_start_free")}
            </button>
          </div>
        </div>
      )}

      {/* ─── HERO ───────────────────────────────────────── */}
      <section style={{
        minHeight: "100vh",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, #0F0F0F 0%, #1a1a2e 50%, #16213e 100%)",
        position: "relative", overflow: "hidden",
        padding: isMobile ? "100px 24px 80px" : "80px 32px 60px",
      }}>
        <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(46,125,50,0.15) 0%, transparent 70%)", top: -100, right: -100, animation: "pulse 4s ease infinite" }} />
        <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(21,101,192,0.12) 0%, transparent 70%)", bottom: -80, left: -80, animation: "pulse 5s ease infinite 1s" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

        <div style={{ position: "relative", textAlign: "center", maxWidth: 760, margin: "0 auto", width: "100%" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 30, padding: "6px 16px", marginBottom: 28 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2E7D32", display: "inline-block", boxShadow: "0 0 8px #2E7D32" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 600, letterSpacing: 0.5 }}>{t("land_badge")}</span>
          </div>

          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 44 : 76, fontWeight: 900, color: "#fff", lineHeight: 1.08, marginBottom: 24, letterSpacing: -2 }}>
            {t("land_hero_title")}<br />
            <span style={{ background: "linear-gradient(90deg, #4CAF50, #2196F3, #FF9800)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              {t("land_hero_title2")}
            </span>
          </h1>

          <p style={{ fontSize: isMobile ? 16 : 20, color: "rgba(255,255,255,0.65)", lineHeight: 1.6, marginBottom: 44, maxWidth: 560, margin: "0 auto 44px" }}>
            {t("land_hero_desc")}
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 40 }}>
            <button onClick={onSignUp} className="btn-primary" style={{ background: "#fff", color: "#0F0F0F", border: "none", borderRadius: 14, padding: isMobile ? "13px 24px" : "14px 32px", fontSize: isMobile ? 14 : 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", width: isMobile ? "100%" : "auto" }}>
              {t("land_start_free")}
            </button>
            <button onClick={onSignIn} className="btn-ghost" style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 14, padding: isMobile ? "13px 24px" : "14px 28px", fontSize: isMobile ? 14 : 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", width: isMobile ? "100%" : "auto" }}>
              {t("land_signin")}
            </button>
            <button onClick={onGuest} style={{ background: "transparent", color: "rgba(255,255,255,0.55)", border: "none", padding: "12px 16px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3, width: isMobile ? "100%" : "auto" }}>
              {t("land_guest_access")}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: isMobile ? 12 : 20, flexWrap: "wrap" }}>
            {[t("land_free"), t("land_no_card"), t("land_multi_currency"), t("land_export_pdf")].map(label => (
              <span key={label} style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>{label}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ─── STATS BAR ──────────────────────────────────── */}
      <section style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "24px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 16 }}>
          {[
            { value: "100%", label: t("land_stat_auto") },
            { value: "12+", label: t("land_stat_categories") },
            { value: "6", label: t("land_stat_currencies") },
            { value: "∞", label: t("land_stat_participants") },
          ].map((s, i, arr) => (
            <div key={s.label} style={{ textAlign: "center", padding: "12px 8px", borderRight: !isMobile && i < arr.length - 1 ? "1px solid #f0f0f0" : "none" }}>
              <div style={{ fontSize: isMobile ? 24 : 30, fontWeight: 800, fontFamily: "'Playfair Display', serif", color: "#0F0F0F", marginBottom: 4 }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── HOW IT WORKS ───────────────────────────────── */}
      <section id="how" style={{ background: "#fafafa", padding: isMobile ? "64px 24px" : "96px 32px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#2E7D32", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>{t("land_how")}</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 30 : 44, fontWeight: 700, color: "#0F0F0F", marginBottom: 14, lineHeight: 1.2 }}>{t("land_how_title")}</h2>
            <p style={{ fontSize: 16, color: "#666", maxWidth: 440, margin: "0 auto", lineHeight: 1.6 }}>{t("land_how_desc")}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: isMobile ? 24 : 32 }}>
            {steps.map((s) => (
              <div key={s.num} style={{ textAlign: "center" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#0F0F0F", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 28, border: "4px solid #fff", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
                  {s.icon}
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#bbb", letterSpacing: 2, marginBottom: 10 }}>{s.num}</div>
                <h3 style={{ fontSize: 19, fontWeight: 700, color: "#0F0F0F", marginBottom: 10, fontFamily: "'Playfair Display', serif" }}>{s.title}</h3>
                <p style={{ fontSize: 14, color: "#666", lineHeight: 1.6, maxWidth: 240, margin: "0 auto" }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FEATURES ───────────────────────────────────── */}
      <section id="features" style={{ background: "#fff", padding: isMobile ? "64px 24px" : "96px 32px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1565C0", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>{t("land_features")}</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 30 : 44, fontWeight: 700, color: "#0F0F0F", marginBottom: 14, lineHeight: 1.2 }}>{t("land_feat_title")}</h2>
            <p style={{ fontSize: 16, color: "#666", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>{t("land_feat_desc")}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 16 }}>
            {features.map((f) => (
              <div key={f.title} className="feature-card" style={{ background: "#fafafa", borderRadius: 16, padding: isMobile ? "20px 16px" : "24px 20px", border: "1px solid #f0f0f0", cursor: "default" }}>
                <div style={{ fontSize: isMobile ? 26 : 30, marginBottom: 12 }}>{f.icon}</div>
                <h3 style={{ fontSize: isMobile ? 13 : 15, fontWeight: 700, color: "#0F0F0F", marginBottom: 8 }}>{f.title}</h3>
                <p style={{ fontSize: isMobile ? 12 : 13, color: "#777", lineHeight: 1.5 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── USE CASES ──────────────────────────────────── */}
      <section id="usecases" style={{ background: "#0F0F0F", padding: isMobile ? "64px 24px" : "96px 32px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#F57F17", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>{t("land_usecases")}</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 30 : 44, fontWeight: 700, color: "#fff", marginBottom: 14, lineHeight: 1.2 }}>{t("land_use_title")}</h2>
            <p style={{ fontSize: 16, color: "rgba(255,255,255,0.5)", maxWidth: 440, margin: "0 auto", lineHeight: 1.6 }}>{t("land_use_desc")}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)", gap: 14 }}>
            {useCases.map((u) => (
              <div key={u.title} className="use-card" style={{ background: "rgba(255,255,255,0.05)", borderRadius: 16, padding: isMobile ? "20px 16px" : "26px 20px", border: "1px solid rgba(255,255,255,0.08)", cursor: "default" }}>
                <div style={{ fontSize: isMobile ? 28 : 34, marginBottom: 14 }}>{u.emoji}</div>
                <h3 style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{u.title}</h3>
                <p style={{ fontSize: isMobile ? 12 : 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ────────────────────────────────────────── */}
      <section style={{ background: "linear-gradient(135deg, #2E7D32 0%, #1565C0 100%)", padding: isMobile ? "64px 24px" : "96px 32px", textAlign: "center" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 30 : 46, fontWeight: 700, color: "#fff", marginBottom: 18, lineHeight: 1.15 }}>
            {t("land_cta_title")}
          </h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.8)", marginBottom: 40, lineHeight: 1.6 }}>
            {t("land_cta_desc")}
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={onSignUp} className="btn-primary" style={{ background: "#fff", color: "#0F0F0F", border: "none", borderRadius: 14, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", width: isMobile ? "100%" : "auto" }}>
              {t("land_start_free")}
            </button>
            <button onClick={onGuest} className="btn-ghost" style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 14, padding: "14px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", width: isMobile ? "100%" : "auto" }}>
              {t("land_guest_access")}
            </button>
          </div>
          <p style={{ marginTop: 20, fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
            {t("land_already_account")}{" "}
            <button onClick={onSignIn} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.8)", cursor: "pointer", textDecoration: "underline", fontSize: 13, fontFamily: "inherit", fontWeight: 600 }}>
              {t("land_signin")}
            </button>
          </p>
        </div>
      </section>

      {/* ─── FOOTER ─────────────────────────────────────── */}
      <footer style={{ background: "#0a0a0a", padding: isMobile ? "40px 24px 28px" : "48px 32px 32px", color: "rgba(255,255,255,0.4)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 28, marginBottom: 32 }}>
            <div style={{ maxWidth: 240 }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 8 }}>SplitLy</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,0.35)" }}>{t("land_footer_tagline")}</p>
            </div>
            {!isMobile && (
              <div style={{ display: "flex", gap: 48 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 14 }}>{t("land_footer_app")}</div>
                  {[t("land_features"), t("land_how"), t("land_usecases")].map(l => (
                    <div key={l} style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 10 }}>{l}</div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 14 }}>{t("land_footer_account")}</div>
                  {[
                    { label: t("land_signin"), action: onSignIn },
                    { label: t("land_signup"), action: onSignUp },
                    { label: t("land_guest_access"), action: onGuest },
                  ].map(l => (
                    <div key={l.label} onClick={l.action} style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 10, cursor: "pointer" }}>{l.label}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 12 }}>© 2026 SplitLy. {t("land_footer_rights")}</span>
            <span style={{ fontSize: 12 }}>{t("land_footer_love")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
