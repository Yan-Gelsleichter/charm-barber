import { useCallback, useEffect, useState } from "react";

const THEME_KEY = "app_theme";

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

/** Tema escuro/claro persistido no dispositivo. */
export function useDarkMode() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    const isDark = stored ? stored === "dark" : true;
    setDark(isDark);
    applyTheme(isDark);
  }, []);

  const toggle = useCallback((next: boolean) => {
    setDark(next);
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    applyTheme(next);
  }, []);

  return { dark, setDark: toggle };
}


/**
 * Aplica a cor primária escolhida pelo admin no CSS.
 * Sobrescreve as variáveis --brand-from e --brand-to no :root.
 */
export function useApplyPrimaryColor(color?: string | null) {
  useEffect(() => {
    const root = document.documentElement;
    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
      root.style.setProperty("--brand-from", color);
      root.style.setProperty("--brand-to", color);
      root.style.setProperty("--primary", color);
      root.style.setProperty("--ring", color);
      // contraste do texto sobre a cor primária
      const r = parseInt(color.slice(1, 3), 16) / 255;
      const g = parseInt(color.slice(3, 5), 16) / 255;
      const b = parseInt(color.slice(5, 7), 16) / 255;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      root.style.setProperty(
        "--primary-foreground",
        lum > 0.55 ? "oklch(0.15 0.02 240)" : "oklch(0.99 0 0)",
      );
    } else {
      root.style.removeProperty("--brand-from");
      root.style.removeProperty("--brand-to");
      root.style.removeProperty("--primary");
      root.style.removeProperty("--ring");
      root.style.removeProperty("--primary-foreground");
    }
  }, [color]);
}

