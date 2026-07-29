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
    } else {
      root.style.removeProperty("--brand-from");
      root.style.removeProperty("--brand-to");
    }
  }, [color]);
}
