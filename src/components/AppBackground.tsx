import { useEffect } from "react";

import { useDarkMode } from "@/lib/theme";

/**
 * Imagem de fundo da tela toda, atrás do conteúdo. Uma camada da cor do tema
 * por cima (mais forte no tema claro) mantém os textos legíveis. Enquanto a
 * imagem está ativa o fundo do <body> fica transparente — sem isso ele
 * cobriria a imagem.
 */
export function AppBackground({ src }: { src: string | null }) {
  const { dark } = useDarkMode();

  useEffect(() => {
    if (!src) return;
    const previous = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "transparent";
    return () => {
      document.body.style.backgroundColor = previous;
    };
  }, [src]);

  if (!src) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center"
      style={{ backgroundImage: `url("${src}")` }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `color-mix(in oklab, var(--color-background) ${dark ? 35 : 75}%, transparent)`,
        }}
      />
    </div>
  );
}
