import { useEffect } from "react";

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
