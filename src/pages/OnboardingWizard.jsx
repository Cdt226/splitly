// src/pages/OnboardingWizard.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { ONBOARDING_KEY } from "../hooks/storage.js";

export function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      icon: "🎊",
      title: "Bienvenue sur SplitLy !",
      desc: "Gérez vos dépenses partagées en quelques clics. Voyages, restos, colocations — plus de calculs à la main.",
      cta: "Commencer →",
    },
    {
      icon: "👥",
      title: "Créez un événement",
      desc: "Donnez un nom à votre sortie, ajoutez vos amis et choisissez une devise. C'est tout pour commencer.",
      cta: "Compris →",
    },
    {
      icon: "💸",
      title: "Enregistrez les dépenses",
      desc: "Ajoutez chaque dépense, qui a payé et qui est concerné. SplitLy calcule automatiquement qui doit quoi.",
      cta: "C'est parti !",
    },
  ];

  const current = steps[step];

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
        {/* Indicateur d'étapes */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 28 }}>
          {steps.map((_, i) => (
            <div key={i} style={{ width: i === step ? 24 : 8, height: 8, borderRadius: 4, background: i === step ? "#0F0F0F" : "var(--border)", transition: "all 0.3s" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)}
              style={{ padding: "12px 20px", borderRadius: 12, border: "1.5px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
              ← Retour
            </button>
          )}
          <button
            onClick={() => {
              if (step < steps.length - 1) {
                setStep(s => s + 1);
              } else {
                try { localStorage.setItem(ONBOARDING_KEY, "true"); } catch {}
                onComplete();
              }
            }}
            style={{ padding: "12px 28px", borderRadius: 12, background: "#0F0F0F", color: "#fff", border: "none", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flex: 1 }}>
            {current.cta}
          </button>
        </div>
        <button onClick={() => { try { localStorage.setItem(ONBOARDING_KEY, "true"); } catch {} onComplete(); }}
          style={{ marginTop: 16, background: "none", border: "none", color: "var(--text-sub)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          Passer l'introduction
        </button>
      </div>
    </div>
  );
}
