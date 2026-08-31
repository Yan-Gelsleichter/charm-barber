import { useEffect, useState } from "react";
import { Share, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";

const DISMISSED_KEY = "ios_a2hs_dismissed";

function isIosSafariVisitor(): boolean {
  if (typeof navigator === "undefined") return false;
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  // Já rodando como app instalado (adicionado à tela de início) — não faz
  // sentido pedir de novo.
  const standalone = (navigator as { standalone?: boolean }).standalone === true;
  return isIos && !standalone;
}

/**
 * Convite visual pro cliente de iPhone/iPad adicionar o site à tela de
 * início — não existe API no iOS pra automatizar isso, então é só um guia
 * com os passos do Safari. Some quando fechado e não volta mais nesse
 * aparelho (guardado em localStorage).
 */
export function IosAddToHomeBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISSED_KEY) === "1") return;
    } catch {
      /* ignora */
    }
    if (isIosSafariVisitor()) setVisible(true);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignora */
    }
  }

  if (!visible) return null;

  return (
    <div className="surface relative space-y-3 p-4">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2"
        onClick={dismiss}
        aria-label="Fechar"
      >
        <X className="size-4" />
      </Button>

      <p className="pr-8 text-sm font-semibold">Adicione este site à sua tela de início</p>
      <p className="text-xs text-muted-foreground">
        Assim você abre direto, como um app — sem precisar entrar pelo navegador. É rapidinho:
      </p>

      <ol className="space-y-2 text-xs text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="brand-gradient flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white">
            1
          </span>
          Toque no ícone <Share className="mx-1 inline size-4 text-foreground" /> de compartilhar,
          na barra do Safari
        </li>
        <li className="flex items-center gap-2">
          <span className="brand-gradient flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white">
            2
          </span>
          Toque em <Plus className="mx-1 inline size-4 text-foreground" /> "Adicionar à Tela de
          Início"
        </li>
        <li className="flex items-center gap-2">
          <span className="brand-gradient flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white">
            3
          </span>
          Confirme em "Adicionar"
        </li>
      </ol>

      <p className="text-[11px] text-muted-foreground">
        Esses passos são do próprio Safari — não temos como fazer isso automaticamente pra você.
      </p>
    </div>
  );
}
