// src/styles.js
// Styles partagés entre composants

export const S = {
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  input: { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid var(--border)", fontSize: 13, outline: "none", background: "var(--input-bg)", boxSizing: "border-box", color: "var(--text)", transition: "border-color 0.15s", fontFamily: "inherit" },
  btnDark: { background: "var(--btn-dark-bg)", color: "var(--btn-dark-text)", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s" },
  btnGhost: { background: "transparent", color: "var(--text-muted)", border: "1.5px solid var(--border)", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
  card: { background: "var(--card-bg)", borderRadius: 16, padding: 20, border: "1px solid var(--border)", marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: 700, marginBottom: 16, color: "var(--text)" },
};
