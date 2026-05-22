// src/pages/ContributionsPage.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, fetchCotisations } from "../supabase.js";
import { CATEGORIES, CURRENCIES, AVATAR_EMOJIS } from "../constants.js";
import { fmt, currencySymbol, computeOwed, computeNetBalance, isSettled, isExactlySettled, settleStatus, validateAmount, computeTransactions, getAvatarMap, saveAvatarEmoji } from "../utils.js";
import { S } from "../styles.js";
import { Avatar, AvatarStack, EmojiPicker, Truncate, Badge, EmptyState, Chip, ParticipantInput, ParticipantToggle, Modal, ConfirmModal, Spinner, StatCard } from "../components/ui/index.jsx";
import { useTranslation } from "../i18n.jsx";
import { Balance } from "./Balance.jsx";
import { CotisationsPage } from "./CotisationsPage.jsx";

export function ContributionsPage({ events, expenses, contributions, user, reload, isMobile, addToast }) {
  const [filterEvent, setFilterEvent] = useState(events[0]?.id || "");
  const [cotisations, setCotisations] = useState([]);
  const ev = events.find(e => e.id === filterEvent);
  const isBudget = ev?.event_type === "budget";

  useEffect(() => {
    if (isBudget && filterEvent) {
      fetchCotisations(filterEvent).then(({ data }) => setCotisations(data || []));
    }
  }, [filterEvent, isBudget]);

  return (
    <div>
      {/* Sélecteur événement */}
      <div className="flex justify-between items-center mb-5 flex-wrap gap-3">
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 26, fontWeight: 700, marginBottom: 2, color: "var(--text)" }}>
            {isBudget ? "💰 Cotisations" : "⊜ Répartition"}
          </h2>
          <p className="text-[12px]" style={{ color: "var(--text-sub)" }}>
            {isBudget ? "Gestion des cotisations et contributions" : "Soldes calculés en temps réel"}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select style={{ ...S.input, width: "auto" }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.event_type === "budget" ? "🏦 " : "💸 "}{ev.name}</option>)}
          </select>
          {isBudget && (
            <button onClick={() => exportCotisationsPDF(ev, cotisations)}
              style={{ ...S.btnGhost, fontSize: 12, padding: "8px 14px", whiteSpace: "nowrap" }}>
              📄 PDF Cotisations
            </button>
          )}
        </div>
      </div>

      {/* Routing selon le type */}
      {isBudget ? (
        <CotisationsPage
          events={events.filter(e => e.id === filterEvent)}
          expenses={expenses}
          user={user}
          reload={async () => {
            await reload();
            const { data } = await fetchCotisations(filterEvent);
            setCotisations(data || []);
          }}
          isMobile={isMobile}
          addToast={addToast}
          hideHeader={true}
        />
      ) : (
        <Balance
          events={events}
          expenses={expenses}
          contributions={contributions}
          user={user}
          reload={reload}
          isMobile={isMobile}
          addToast={addToast}
          initialEvent={filterEvent}
          hideHeader={true}
        />
      )}
    </div>
  );
}
