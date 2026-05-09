// src/hooks/useGuestSession.js

const GUEST_SESSION_KEY = "splitly_guest_session";
const GUEST_SESSION_DAYS = 30;

export function saveGuestSession(email) {
  try {
    const session = { email, expires: Date.now() + GUEST_SESSION_DAYS * 86400000 };
    localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
  } catch {}
}

export function loadGuestSession() {
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.email || !session.expires) return null;
    if (Date.now() > session.expires) {
      localStorage.removeItem(GUEST_SESSION_KEY);
      return null;
    }
    return session.email;
  } catch { return null; }
}

export function clearGuestSession() {
  try { localStorage.removeItem(GUEST_SESSION_KEY); } catch {}
  // Nettoyage ancienne clé si présente
  try { localStorage.removeItem("splitly_guest_email"); } catch {}
}
