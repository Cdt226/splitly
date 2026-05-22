// src/hooks/useTheme.jsx
import { useState, useEffect, useCallback, createContext, useContext } from "react";

const THEME_KEY = "splitly_theme";
export const ThemeContext = createContext({ dark: false, toggle: () => {} });

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === "dark"; } catch { return false; }
  });

  const toggle = useCallback(() => {
    setDark(d => {
      const next = !d;
      try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    if (dark) {
      root.style.setProperty("--bg", "#111");
      root.style.setProperty("--bg-secondary", "#1a1a1a");
      root.style.setProperty("--card-bg", "#1e1e1e");
      root.style.setProperty("--border", "#2a2a2a");
      root.style.setProperty("--text", "#f0f0f0");
      root.style.setProperty("--text-muted", "#888");
      root.style.setProperty("--text-sub", "#666");
      root.style.setProperty("--input-bg", "#252525");
      root.style.setProperty("--btn-dark-bg", "#fff");
      root.style.setProperty("--btn-dark-text", "#0F0F0F");
      root.style.setProperty("--hover-bg", "#252525");
      root.style.setProperty("--stat-bg", "#1e1e1e");
      document.body.style.background = "#111";
      document.body.style.color = "#f0f0f0";
    } else {
      root.style.setProperty("--bg", "#f2f2f2");
      root.style.setProperty("--bg-secondary", "#fff");
      root.style.setProperty("--card-bg", "#f9f9f9");
      root.style.setProperty("--border", "#e5e5e5");
      root.style.setProperty("--text", "#1a1a1a");
      root.style.setProperty("--text-muted", "#555");
      root.style.setProperty("--text-sub", "#aaa");
      root.style.setProperty("--input-bg", "#fff");
      root.style.setProperty("--btn-dark-bg", "#0F0F0F");
      root.style.setProperty("--btn-dark-text", "#fff");
      root.style.setProperty("--hover-bg", "#f5f5f5");
      root.style.setProperty("--stat-bg", "#f9f9f9");
      document.body.style.background = "#f2f2f2";
      document.body.style.color = "#1a1a1a";
    }
  }, [dark]);

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      <style>{`
        :root {
          --bg: #f2f2f2; --bg-secondary: #fff; --card-bg: #f9f9f9;
          --border: #e5e5e5; --text: #1a1a1a; --text-muted: #555;
          --text-sub: #aaa; --input-bg: #fff; --btn-dark-bg: #0F0F0F;
          --btn-dark-text: #fff; --hover-bg: #f5f5f5; --stat-bg: #f9f9f9;
        }
        * { box-sizing: border-box; transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease; }
        body { margin: 0; }
      `}</style>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
