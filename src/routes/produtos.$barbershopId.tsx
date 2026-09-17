import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import type { Product } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { brl, phoneDigits } from "@/lib/format";
import { postPublicApi } from "@/lib/api-fetch";
import { useProductCart } from "@/hooks/use-product-cart";

export const Route = createFileRoute("/produtos/$barbershopId")({
  head: () => ({ meta: [{ title: "Produtos — APP BARBEARIAS" }] }),
  component: ProdutosPage,
});

function ProdutosPage() {
  const { barbershopId } = Route.useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const cart = useProductCart(barbershopId);

  const meta = (session?.user.user_metadata ?? {}) as Record<string, string | undefined>;
  const [name, setName] = useState(() => (meta.name || meta.full_name || "").toString());
  const [phone, setPhone] = useState(() => (meta.whatsapp_digits || meta.whatsapp || "").toString());
  const email = (session?.user.email ?? meta.email ?? "").toString().trim().toLowerCase() || null;

  const productsQ = useQuery({
    queryKey: ["client-products", barbershopId],
    queryFn: async (): Promise<Product[]> => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("barbershop_id", barbershopId)
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Product[];
    },
  });

  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    (productsQ.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [productsQ.data]);

  const cartItems = useMemo(
    () =>
      Object.entries(cart.cart)
        .map(([productId, quantity]) => ({ product: productById.get(productId), quantity }))
        .filter((i): i is { product: Product; quantity: number } => !!i.product),
    [cart.cart, productById],
  );

  const total = cartItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0);

  const checkout = useMutation({
    mutationFn: async () => {
      const nome = name.trim();
      if (nome.length < 2) throw new Error("Informe seu nome");
      const telefone = phoneDigits(phone);
      if (telefone.length < 8) throw new Error("Informe um telefone válido");
      if (!email) throw new Error("Sua conta precisa ter um e-mail para comprar");
      if (cartItems.length === 0) throw new Error("Seu carrinho está vazio");

      const result = await postPublicApi<{ id?: string; init_point?: string; error?: string }>(
        "/api/public/product-order-create",
        {
          barbershop_id: barbershopId,
          customer_name: nome,
          customer_phone: telefone,
          customer_email: email,
          items: cartItems.map((i) => ({ product_id: i.product.id, quantity: i.quantity })),
        },
        session?.access_token,
      );
      if (!result?.init_point || !result.id) throw new Error(result?.error ?? "Não foi possível iniciar a compra.");

      void (async () => {
        const { requestPushToken } = await import("@/lib/push-client");
        const token = await requestPushToken();
        if (!token) return;
        await postPublicApi(
          "/api/public/product-order-push-token",
          { order_id: result.id, customer_phone: telefone, push_token: token },
        ).catch(() => {});
      })();

      return result.init_point;
    },
    onSuccess: (initPoint) => {
      cart.clear();
      window.location.href = initPoint;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-2xl px-5 pb-32 pt-6">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to="/">
          <ArrowLeft /> Voltar
        </Link>
      </Button>

      <header className="mb-6">
        <h1 className="text-xl font-semibold">Produtos</h1>
        <p className="mt-1 text-sm text-muted-foreground">Escolha os produtos e retire na barbearia.</p>
      </header>

      {productsQ.isLoading && (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="surface h-40 animate-pulse" />
          ))}
        </div>
      )}

      {!productsQ.isLoading && (productsQ.data ?? []).length === 0 && (
        <div className="surface p-8 text-center text-sm text-muted-foreground">
          Nenhum produto disponível no momento.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {productsQ.data?.map((p) => {
          const esgotado = p.stock_quantity <= 0;
          const qtyInCart = cart.cart[p.id] ?? 0;
          return (
            <div key={p.id} className="surface p-3">
              <div className="mb-2 flex h-24 w-full items-center justify-center overflow-hidden rounded-lg bg-secondary">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.title} className="h-full w-full object-cover" />
                ) : (
                  <ShoppingBag className="text-muted-foreground" />
                )}
              </div>
              <p className="truncate text-sm font-semibold">{p.title}</p>
              <p className="brand-text text-sm font-bold">{brl(p.price)}</p>
              {esgotado ? (
                <span className="mt-2 block rounded-full bg-muted px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Esgotado
                </span>
              ) : (
                <Button
                  size="sm"
                  variant={qtyInCart > 0 ? "hero" : "outline"}
                  className="mt-2 w-full"
                  onClick={() => cart.add(p.id)}
                >
                  {qtyInCart > 0 ? `Adicionado (${qtyInCart})` : "Adicionar"}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {cartItems.length > 0 && (
        <section className="surface mt-8 space-y-4 p-4">
          <h2 className="font-semibold">Seu carrinho</h2>

          <div className="space-y-2">
            {cartItems.map(({ product, quantity }) => {
              const maxQty = Math.max(quantity, product.stock_quantity);
              return (
                <div key={product.id} className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{product.title}</p>
                    <p className="text-xs text-muted-foreground">{brl(product.price)} cada</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => cart.setQuantity(product.id, quantity - 1)}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <span className="w-6 text-center text-sm font-semibold">{quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8"
                      disabled={quantity >= maxQty}
                      onClick={() => cart.setQuantity(product.id, quantity + 1)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      onClick={() => cart.setQuantity(product.id, 0)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-3">
            <label className="grid grid-cols-1 gap-1.5 text-sm font-medium">
              Nome
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
            </label>
            <label className="grid grid-cols-1 gap-1.5 text-sm font-medium">
              Telefone
              <PhoneInput value={phone} onChange={setPhone} />
            </label>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="font-semibold">Total</span>
            <span className="brand-text text-lg font-bold">{brl(total)}</span>
          </div>

          <Button
            variant="hero"
            size="xl"
            className="w-full"
            disabled={checkout.isPending}
            onClick={() => checkout.mutate()}
          >
            {checkout.isPending ? <Loader2 className="animate-spin" /> : "Finalizar compra"}
          </Button>
        </section>
      )}
    </main>
  );
}
