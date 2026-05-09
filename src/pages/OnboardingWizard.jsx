// src/pages/OnboardingWizard.jsx
import { useState } from "react";
import { ONBOARDING_KEY } from "../hooks/storage.js";
import { useTranslation } from "../i18n.jsx";

export function OnboardingWizard({ onComplete }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  const steps = [
    { icon: "🎊", title: t("onb_step1_title"), desc: t("onb_step1_desc"), cta: t("onb_step1_cta") },
    { icon: "👥", title: t("onb_step2_title"), desc: t("onb_step2_desc"), cta: t("onb_step2_cta") },
    { icon: "💸", title: t("onb_step3_title"), desc: t("onb_step3_desc"), cta: t("onb_step3_cta") },
  ];

  const current = steps[step];
  const complete = () => {
    try { localStorage.setItem(ONBOARDING_KEY, "true"); } catch {}
    onComplete();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}>
      <div style={{ background: "var(--bg-secondary)", borderRadius: 24, padding: 40, maxWidth: 420, width: "100%", textAlign: "center", boxShadow: "0 32px 80px rgba(0,0,0,0.4)" }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>{current.icon}</div>
        <div style={{ fontSize: 22, fontFamily: "'Playfair Display', serif", fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>
          {current.title}
        </div>
        <div style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 32 }}>
          {current.desc}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 28 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ width: i === step ? 24 : 8, height: 8, borderRadius: 4, background: i === step ? "#0F0F0F" : "var(--border)", transition: "all 0.3s" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              style={{ padding: "12px 20px", borderRadius: 12, border: "1.5px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
              ← {t("back")}
            </button>
          )}
          <button
            onClick={() => step < steps.length - 1 ? setStep(s => s + 1) : complete()}
            style={{ padding: "12px 28px", borderRadius: 12, background: "#0F0F0F", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flex: 1 }}>
            {current.cta}
          </button>
        </div>
        <button onClick={complete}
          style={{ marginTop: 16, background: "none", border: "none", color: "var(--text-sub)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          {t("onb_skip")}
        </button>
      </div>
    </div>
  );
}
