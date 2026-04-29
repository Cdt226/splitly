import { useState, useEffect } from "react";

export default function LandingPage({ onSignIn, onSignUp, onGuest }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
  ];

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", color: "#1a1a1a", overflowX: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
        .fade-up { animation: fadeUp 0.6s ease forwards; }
        .btn-primary:hover { opacity: 0.88; transform: translateY(-1px); }
        .btn-secondary:hover { background: #f5f5f5; transform: translateY(-1px); }
        .btn-ghost:hover { background: rgba(255,255,255,0.1); }
        .feature-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.1); }
        .use-card:hover { transform: translateY(-3px); }
        .btn-primary, .btn-secondary, .btn-ghost, .feature-card, .use-card { transition: all 0.2s ease; }
      `}</style>

      {/* ─── NAVBAR ─────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        background: scrolled ? "rgba(255,255,255,0.95)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(0,0,0,0.08)" : "none",
        padding: "0 24px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        transition: "all 0.3s ease",
      }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: scrolled ? "#0F0F0F" : "#fff", letterSpacing: -0.5 }}>
          SplitLy
        </div>

        {/* Desktop nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, "@media(max-width:640px)": { display: "none" } }}>
          <a href="#features" style={{ fontSize: 14, color: scrolled ? "#555" : "rgba(255,255,255,0.8)", textDecoration: "none", padding: "8px 14px", borderRadius: 8, fontWeight: 500 }}>Fonctionnalités</a>
          <a href="#how" style={{ fontSize: 14, color: scrolled ? "#555" : "rgba(255,255,255,0.8)", textDecoration: "none", padding: "8px 14px", borderRadius: 8, fontWeight: 500 }}>Comment ça marche</a>
          <a href="#usecases" style={{ fontSize: 14, color: scrolled ? "#555" : "rgba(255,255,255,0.8)", textDecoration: "none", padding: "8px 14px", borderRadius: 8, fontWeight: 500 }}>Cas d'usage</a>
          <div style={{ width: 1, height: 20, background: scrolled ? "#e0e0e0" : "rgba(255,255,255,0.3)", margin: "0 8px" }} />
          <button onClick={onGuest} className="btn-ghost" style={{ fontSize: 13, color: scrolled ? "#555" : "rgba(255,255,255,0.9)", background: "transparent", border: `1px solid ${scrolled ? "#e0e0e0" : "rgba(255,255,255,0.3)"}`, borderRadius: 10, padding: "8px 16px", cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>
            Accès invité
          </button>
          <button onClick={onSignIn} className="btn-secondary" style={{ fontSize: 13, color: "#0F0F0F", background: scrolled ? "#fff" : "rgba(255,255,255,0.95)", border: "none", borderRadius: 10, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
            Se connecter
          </button>
          <button onClick={onSignUp} className="btn-primary" style={{ fontSize: 13, color: "#fff", background: "#0F0F0F", border: "none", borderRadius: 10, padding: "9px 20px", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
            S'inscrire →
          </button>
        </div>

        {/* Mobile hamburger */}
        <button onClick={() => setMenuOpen(!menuOpen)} style={{ background: "none", border: "none", cursor: "pointer", color: scrolled ? "#0F0F0F" : "#fff", fontSize: 22, display: "none", "@media(max-width:640px)": { display: "block" } }}>
          {menuOpen ? "×" : "☰"}
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div style={{ position: "fixed", top: 64, left: 0, right: 0, background: "#fff", zIndex: 99, padding: 24, borderBottom: "1px solid #eee", display: "flex", flexDirection: "column", gap: 12 }}>
          <a href="#features" onClick={() => setMenuOpen(false)} style={{ fontSize: 15, color: "#333", textDecoration: "none", fontWeight: 600, padding: "8px 0" }}>Fonctionnalités</a>
          <a href="#how" onClick={() => setMenuOpen(false)} style={{ fontSize: 15, color: "#333", textDecoration: "none", fontWeight: 600, padding: "8px 0" }}>Comment ça marche</a>
          <a href="#usecases" onClick={() => setMenuOpen(false)} style={{ fontSize: 15, color: "#333", textDecoration: "none", fontWeight: 600, padding: "8px 0" }}>Cas d'usage</a>
          <div style={{ borderTop: "1px solid #eee", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={() => { setMenuOpen(false); onGuest(); }} style={{ padding: "12px", borderRadius: 10, border: "1.5px solid #e0e0e0", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Accès invité</button>
            <button onClick={() => { setMenuOpen(false); onSignIn(); }} style={{ padding: "12px", borderRadius: 10, border: "1.5px solid #e0e0e0", background: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Se connecter</button>
            <button onClick={() => { setMenuOpen(false); onSignUp(); }} style={{ padding: "12px", borderRadius: 10, border: "none", background: "#0F0F0F", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>S'inscrire →</button>
          </div>
        </div>
      )}

      {/* ─── HERO ───────────────────────────────────────── */}
      <section style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, #0F0F0F 0%, #1a1a2e 50%, #16213e 100%)",
        position: "relative", overflow: "hidden", padding: "80px 24px 60px",
      }}>
        {/* Decorative blobs */}
        <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(46,125,50,0.15) 0%, transparent 70%)", top: -100, right: -100, animation: "pulse 4s ease infinite" }} />
        <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(21,101,192,0.12) 0%, transparent 70%)", bottom: -80, left: -80, animation: "pulse 5s ease infinite 1s" }} />
        <div style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,127,23,0.08) 0%, transparent 70%)", top: "40%", left: "30%", animation: "pulse 6s ease infinite 2s" }} />

        {/* Grid pattern overlay */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

        <div style={{ position: "relative", textAlign: "center", maxWidth: 760, margin: "0 auto" }}>
          {/* Badge */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 30, padding: "6px 16px", marginBottom: 28, backdropFilter: "blur(8px)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2E7D32", display: "inline-block", boxShadow: "0 0 8px #2E7D32" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 600, letterSpacing: 0.5 }}>Gestion de dépenses partagées</span>
          </div>

          {/* Headline */}
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(40px, 8vw, 76px)", fontWeight: 900, color: "#fff", lineHeight: 1.08, marginBottom: 24, letterSpacing: -2 }}>
            Fini les calculs<br />
            <span style={{ background: "linear-gradient(90deg, #4CAF50, #2196F3, #FF9800)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              à la main.
            </span>
          </h1>

          {/* Subheadline */}
          <p style={{ fontSize: "clamp(16px, 2.5vw, 20px)", color: "rgba(255,255,255,0.65)", lineHeight: 1.6, marginBottom: 44, maxWidth: 560, margin: "0 auto 44px" }}>
            SplitLy gère les dépenses partagées de vos sorties, voyages et soirées. Qui a payé quoi, qui doit combien — tout en quelques clics.
          </p>

          {/* CTA buttons */}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 56 }}>
            <button onClick={onSignUp} className="btn-primary" style={{ background: "#fff", color: "#0F0F0F", border: "none", borderRadius: 14, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
              Commencer gratuitement →
            </button>
            <button onClick={onSignIn} className="btn-ghost" style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 14, padding: "14px 28px", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", backdropFilter: "blur(8px)" }}>
              Se connecter
            </button>
            <button onClick={onGuest} style={{ background: "transparent", color: "rgba(255,255,255,0.55)", border: "none", padding: "14px 20px", fontSize: 14, cursor: "pointer", fontFamily: "inherit", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3 }}>
              Accéder en tant qu'invité
            </button>
          </div>

          {/* Social proof */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
            {["✓ Gratuit", "✓ Aucune carte requise", "✓ Multi-devises", "✓ Export PDF"].map(t => (
              <span key={t} style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>{t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ─── STATS BAR ──────────────────────────────────── */}
      <section style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "28px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 0 }}>
          {[
            { value: "100%", label: "Calculs automatiques" },
            { value: "8+", label: "Catégories de dépenses" },
            { value: "6", label: "Devises supportées" },
            { value: "∞", label: "Participants par événement" },
          ].map((s, i, arr) => (
            <div key={s.label} style={{ textAlign: "center", padding: "12px 24px", borderRight: i < arr.length - 1 ? "1px solid #f0f0f0" : "none" }}>
              <div style={{ fontSize: 30, fontWeight: 800, fontFamily: "'Playfair Display', serif", color: "#0F0F0F", marginBottom: 4 }}>{s.value}</div>
              <div style={{ fontSize: 13, color: "#888", fontWeight: 500 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── HOW IT WORKS ───────────────────────────────── */}
      <section id="how" style={{ background: "#fafafa", padding: "96px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#2E7D32", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Fonctionnement</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 700, color: "#0F0F0F", marginBottom: 16, lineHeight: 1.2 }}>
              Simple comme bonjour.
            </h2>
            <p style={{ fontSize: 17, color: "#666", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
              Trois étapes suffisent pour gérer n'importe quelle dépense partagée.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 32, position: "relative" }}>
            {/* Connector line (desktop) */}
            <div style={{ position: "absolute", top: 40, left: "16.5%", right: "16.5%", height: 2, background: "linear-gradient(90deg, #2E7D32, #1565C0, #F57F17)", borderRadius: 2, zIndex: 0 }} />

            {steps.map((s, i) => (
              <div key={s.num} style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
                <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#0F0F0F", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", fontSize: 32, border: "4px solid #fff", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
                  {s.icon}
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#aaa", letterSpacing: 2, marginBottom: 10 }}>{s.num}</div>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: "#0F0F0F", marginBottom: 12, fontFamily: "'Playfair Display', serif" }}>{s.title}</h3>
                <p style={{ fontSize: 14, color: "#666", lineHeight: 1.6, maxWidth: 240, margin: "0 auto" }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FEATURES ───────────────────────────────────── */}
      <section id="features" style={{ background: "#fff", padding: "96px 24px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1565C0", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Fonctionnalités</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 700, color: "#0F0F0F", marginBottom: 16, lineHeight: 1.2 }}>
              Tout ce dont vous avez besoin.
            </h2>
            <p style={{ fontSize: 17, color: "#666", maxWidth: 520, margin: "0 auto", lineHeight: 1.6 }}>
              SplitLy couvre tous les cas de figure, des plus simples aux plus complexes.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 20 }}>
            {features.map((f, i) => (
              <div key={f.title} className="feature-card" style={{ background: "#fafafa", borderRadius: 18, padding: "28px 24px", border: "1px solid #f0f0f0", cursor: "default" }}>
                <div style={{ fontSize: 32, marginBottom: 16 }}>{f.icon}</div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0F0F0F", marginBottom: 10 }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: "#777", lineHeight: 1.6 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── USE CASES ──────────────────────────────────── */}
      <section id="usecases" style={{ background: "#0F0F0F", padding: "96px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#F57F17", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>Cas d'usage</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 700, color: "#fff", marginBottom: 16, lineHeight: 1.2 }}>
              Pour toutes vos aventures.
            </h2>
            <p style={{ fontSize: 17, color: "rgba(255,255,255,0.55)", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
              Peu importe l'occasion, SplitLy s'adapte à votre situation.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            {useCases.map((u, i) => (
              <div key={u.title} className="use-card" style={{ background: "rgba(255,255,255,0.05)", borderRadius: 18, padding: "28px 22px", border: "1px solid rgba(255,255,255,0.08)", cursor: "default" }}>
                <div style={{ fontSize: 36, marginBottom: 16 }}>{u.emoji}</div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: "#fff", marginBottom: 10 }}>{u.title}</h3>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA SECTION ────────────────────────────────── */}
      <section style={{ background: "linear-gradient(135deg, #2E7D32 0%, #1565C0 100%)", padding: "96px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(28px, 5vw, 48px)", fontWeight: 700, color: "#fff", marginBottom: 20, lineHeight: 1.15 }}>
            Prêt à simplifier vos dépenses ?
          </h2>
          <p style={{ fontSize: 17, color: "rgba(255,255,255,0.8)", marginBottom: 44, lineHeight: 1.6 }}>
            Créez votre premier événement en moins de 30 secondes. Aucune carte bancaire requise.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={onSignUp} className="btn-primary" style={{ background: "#fff", color: "#0F0F0F", border: "none", borderRadius: 14, padding: "15px 36px", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Commencer gratuitement →
            </button>
            <button onClick={onGuest} className="btn-ghost" style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 14, padding: "15px 28px", fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", backdropFilter: "blur(8px)" }}>
              Accès invité
            </button>
          </div>
          <p style={{ marginTop: 24, fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
            Déjà un compte ? <button onClick={onSignIn} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.8)", cursor: "pointer", textDecoration: "underline", fontSize: 13, fontFamily: "inherit", fontWeight: 600 }}>Se connecter</button>
          </p>
        </div>
      </section>

      {/* ─── FOOTER ─────────────────────────────────────── */}
      <footer style={{ background: "#0a0a0a", padding: "48px 24px 32px", color: "rgba(255,255,255,0.4)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 32, marginBottom: 40 }}>
            <div style={{ maxWidth: 260 }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 10 }}>SplitLy</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: "rgba(255,255,255,0.4)" }}>
                Gestion intelligente des dépenses partagées entre amis, en famille ou entre collègues.
              </p>
            </div>
            <div style={{ display: "flex", gap: 48, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 14 }}>Application</div>
                {["Fonctionnalités", "Comment ça marche", "Cas d'usage"].map(l => (
                  <div key={l} style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 10, cursor: "pointer" }}>{l}</div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 14 }}>Compte</div>
                {[
                  { label: "Se connecter", action: onSignIn },
                  { label: "S'inscrire", action: onSignUp },
                  { label: "Accès invité", action: onGuest },
                ].map(l => (
                  <div key={l.label} onClick={l.action} style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 10, cursor: "pointer" }}>{l.label}</div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <span style={{ fontSize: 12 }}>© 2026 SplitLy. Tous droits réservés.</span>
            <span style={{ fontSize: 12 }}>Fait avec ♥ pour simplifier vos sorties</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
