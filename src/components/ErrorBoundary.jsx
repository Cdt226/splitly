import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (process.env.NODE_ENV === "development") {
      console.error("[ErrorBoundary]", error, info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          minHeight: "100vh", padding: 32, fontFamily: "'DM Sans', sans-serif", background: "var(--bg, #f4f4f4)",
        }}>
          <div style={{ maxWidth: 440, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, marginBottom: 8, color: "var(--text, #0F0F0F)" }}>
              Une erreur inattendue s'est produite
            </h2>
            <p style={{ fontSize: 14, color: "var(--text-sub, #666)", marginBottom: 24, lineHeight: 1.6 }}>
              Cette section n'a pas pu se charger. Rechargez la page ou contactez le support si le problème persiste.
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              style={{ background: "#0F0F0F", color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Recharger la page
            </button>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <pre style={{ marginTop: 20, textAlign: "left", fontSize: 11, background: "#fff0f0", border: "1px solid #ffcdd2", borderRadius: 8, padding: 12, overflow: "auto", maxHeight: 200, color: "#c62828" }}>
                {this.state.error.toString()}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
