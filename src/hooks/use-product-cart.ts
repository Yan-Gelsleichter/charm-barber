import { useCallback, useEffect, useState } from "react";

/**
 * Carrinho de produtos do cliente — só em sessionStorage, sem persistir no
 * banco (se o cliente sair do app o carrinho zera, aceitável pra um
 * catálogo pequeno de barbearia). Guardado por barbershopId pra não
 * misturar carrinho de barbearias diferentes num mesmo aparelho.
 */

function storageKey(barbershopId: string) {
  return `product-cart:${barbershopId}`;
}

function readCart(barbershopId: string): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(storageKey(barbershopId));
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeCart(barbershopId: string, cart: Record<string, number>) {
  try {
    sessionStorage.setItem(storageKey(barbershopId), JSON.stringify(cart));
  } catch {
    /* ignora — carrinho só some da sessão, sem quebrar a compra atual */
  }
}

export function useProductCart(barbershopId: string | null) {
  const [cart, setCart] = useState<Record<string, number>>({});

  useEffect(() => {
    setCart(barbershopId ? readCart(barbershopId) : {});
  }, [barbershopId]);

  const add = useCallback(
    (productId: string, qty = 1) => {
      if (!barbershopId) return;
      setCart((prev) => {
        const next = { ...prev, [productId]: (prev[productId] ?? 0) + qty };
        writeCart(barbershopId, next);
        return next;
      });
    },
    [barbershopId],
  );

  const setQuantity = useCallback(
    (productId: string, qty: number) => {
      if (!barbershopId) return;
      setCart((prev) => {
        const next = { ...prev };
        if (qty <= 0) delete next[productId];
        else next[productId] = qty;
        writeCart(barbershopId, next);
        return next;
      });
    },
    [barbershopId],
  );

  const clear = useCallback(() => {
    if (!barbershopId) return;
    writeCart(barbershopId, {});
    setCart({});
  }, [barbershopId]);

  const totalItems = Object.values(cart).reduce((sum, qty) => sum + qty, 0);

  return { cart, add, setQuantity, clear, totalItems };
}
