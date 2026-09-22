import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Pencil, X, Save, Power, Trash2, Upload, Image as ImageIcon, PackageCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Barber, Product, ProductOrder, ProductOrderItem } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { brl, fmtDateTime } from "@/lib/format";
import { postPublicApi } from "@/lib/api-fetch";

async function bearerToken() {
  const session = (await supabase.auth.getSession()).data.session;
  return session?.access_token;
}

export function ProdutosTab({ barber }: { barber: Barber }) {
  return barber.is_admin ? <ProdutosAdmin barber={barber} /> : <MinhasVendasProdutos barber={barber} />;
}

function ProdutosAdmin({ barber }: { barber: Barber }) {
  const qc = useQueryClient();
  const shopId = barber.barbershop_id ?? null;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [stock, setStock] = useState("0");
  const [editing, setEditing] = useState<Product | null>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setPrice("");
    setImageUrl("");
    setStock("0");
    setEditing(null);
  }

  function startEdit(p: Product) {
    setEditing(p);
    setTitle(p.title);
    setDescription(p.description ?? "");
    setPrice(String(p.price));
    setImageUrl(p.image_url ?? "");
    setStock(String(p.stock_quantity));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Envie um arquivo de imagem");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Máximo 3MB");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop() || "png";
    const path = `${shopId ?? barber.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("productphotos")
      .upload(path, file, { cacheControl: "3600", upsert: true });
    if (error) {
      setUploading(false);
      toast.error("Falha no upload", { description: error.message });
      return;
    }
    const { data } = supabase.storage.from("productphotos").getPublicUrl(path);
    setImageUrl(data.publicUrl);
    setUploading(false);
    toast.success("Foto enviada");
  }

  const productsQ = useQuery({
    queryKey: ["products", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("barbershop_id", shopId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Product[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (title.trim().length < 2) throw new Error("Título muito curto");
      const priceNum = Number(price.replace(",", "."));
      if (!(priceNum >= 0)) throw new Error("Valor inválido");
      const stockNum = Math.max(0, Math.trunc(Number(stock)) || 0);

      const { getBarbershopIdByBarberId } = await import("@/lib/barbershop");
      const barbershopId = shopId ?? (await getBarbershopIdByBarberId(barber.id));
      if (!barbershopId) throw new Error("Não foi possível identificar a barbearia");

      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        price: priceNum,
        image_url: imageUrl.trim() || null,
        stock_quantity: stockNum,
      };
      if (editing) {
        const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert({ ...payload, barbershop_id: barbershopId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Produto atualizado" : "Produto cadastrado");
      reset();
      qc.invalidateQueries({ queryKey: ["products", shopId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Product) => {
      const { error } = await supabase.from("products").update({ active: !p.active }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products", shopId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) {
        if (error.code === "23503") {
          throw new Error(
            "Não é possível excluir: esse produto já tem pedidos. Desative-o em vez de excluir, pra manter o histórico.",
          );
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Produto excluído");
      qc.invalidateQueries({ queryKey: ["products", shopId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Produtos</h1>
        <p className="text-sm text-muted-foreground">
          Cadastre produtos físicos (gel, creme, pente etc.) pra vender pelo app, com retirada na barbearia.
        </p>
      </header>

      <section className="surface space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{editing ? "Editar produto" : "Novo produto"}</h2>
          {editing && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X /> Cancelar
            </Button>
          )}
        </div>

        <div className="space-y-1">
          <Label>Título</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Gel fixador" />
        </div>

        <div className="space-y-1">
          <Label>Descrição (opcional)</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: 250ml, fixação forte" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Valor (R$)</Label>
            <Input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="0,00"
            />
          </div>
          <div className="space-y-1">
            <Label>Estoque</Label>
            <Input
              inputMode="numeric"
              value={stock}
              onChange={(e) => setStock(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Foto</Label>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-border bg-secondary">
              {imageUrl ? (
                <img src={imageUrl} alt="produto" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                Enviar foto
              </Button>
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="ou cole uma URL de imagem"
              />
            </div>
          </div>
        </div>

        <Button variant="hero" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" /> : editing ? <Save /> : <Plus />}
          {editing ? "Salvar alterações" : "Cadastrar produto"}
        </Button>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Catálogo
        </h2>
        {productsQ.data?.length === 0 && (
          <div className="surface p-6 text-center text-sm text-muted-foreground">
            Nenhum produto cadastrado ainda.
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {productsQ.data?.map((p) => (
            <div key={p.id} className="surface flex gap-3 p-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-secondary">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.title} className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold">{p.title}</p>
                  {!p.active && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Inativo
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {brl(p.price)} · estoque: {p.stock_quantity}
                </p>
                <div className="mt-2 flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(p)}>
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={p.active ? "Desativar produto" : "Reativar produto"}
                    onClick={() => toggleActive.mutate(p)}
                  >
                    <Power className={p.active ? "text-destructive" : "text-success"} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Excluir produto"
                    onClick={() => {
                      if (confirm(`Excluir o produto "${p.title}" permanentemente?`)) deleteProduct.mutate(p.id);
                    }}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <ComissaoProdutosBarbeiros shopId={shopId} />
      <PedidosAguardandoRetirada shopId={shopId} />
    </div>
  );
}

type BarberCommissionRow = { id: string; name: string; product_commission_percent: number | null };

function ComissaoProdutosBarbeiros({ shopId }: { shopId: string | null }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const listQ = useQuery({
    queryKey: ["shop-barbers-product-commission", shopId],
    enabled: !!shopId,
    queryFn: async (): Promise<BarberCommissionRow[]> => {
      const { data, error } = await supabase
        .from("barbers")
        .select("id, name, product_commission_percent")
        .eq("barbershop_id", shopId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as BarberCommissionRow[];
    },
  });

  const saveCommission = useMutation({
    mutationFn: async ({ id, percent }: { id: string; percent: number }) => {
      const { error } = await supabase
        .from("barbers")
        .update({ product_commission_percent: percent })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { id }) => {
      setDraft((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      toast.success("Comissão salva");
      qc.invalidateQueries({ queryKey: ["shop-barbers-product-commission", shopId] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar a comissão", { description: e.message }),
  });

  function save(b: BarberCommissionRow) {
    const raw = draft[b.id];
    const percent = Number(raw);
    if (raw === undefined || raw === "" || Number.isNaN(percent) || percent < 0 || percent > 100) {
      toast.error("Informe uma porcentagem entre 0 e 100");
      return;
    }
    saveCommission.mutate({ id: b.id, percent });
  }

  return (
    <section className="surface space-y-4 p-4">
      <div>
        <p className="font-medium">Comissão por barbeiro em produtos</p>
        <p className="text-xs text-muted-foreground md:text-sm">
          % fixa aplicada a qualquer produto que o barbeiro vender presencialmente pela Caixa. O dinheiro da venda
          continua indo inteiro pra conta da barbearia — essa comissão é só um controle pra você saber quanto
          repassar por fora.
        </p>
      </div>

      {listQ.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando barbeiros…
        </p>
      ) : !listQ.data?.length ? (
        <p className="text-sm text-muted-foreground">Nenhum barbeiro cadastrado nesta barbearia.</p>
      ) : (
        <ul className="space-y-3">
          {listQ.data.map((b) => {
            const current = draft[b.id] ?? (b.product_commission_percent ?? "").toString();
            const dirty = draft[b.id] !== undefined;
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-border p-3">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{b.name}</p>
                <Input
                  inputMode="decimal"
                  value={current}
                  onChange={(e) => setDraft((d) => ({ ...d, [b.id]: e.target.value.replace(/[^\d.,]/g, "") }))}
                  className="w-20 text-right"
                  placeholder="0"
                />
                <span className="text-sm text-muted-foreground">%</span>
                <Button
                  size="sm"
                  variant={dirty ? "hero" : "outline"}
                  disabled={!dirty || saveCommission.isPending}
                  onClick={() => save(b)}
                >
                  Salvar
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PedidosAguardandoRetirada({ shopId }: { shopId: string | null }) {
  const qc = useQueryClient();

  const ordersQ = useQuery({
    queryKey: ["product-orders-pending-pickup", shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_orders")
        .select("*")
        .eq("barbershop_id", shopId!)
        .eq("payment_status", "pago")
        .is("fulfilled_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProductOrder[];
    },
  });

  const orderIds = useMemo(() => (ordersQ.data ?? []).map((o) => o.id), [ordersQ.data]);

  const itemsQ = useQuery({
    queryKey: ["product-order-items-pending-pickup", shopId, orderIds.join(",")],
    enabled: orderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("product_order_items").select("*").in("order_id", orderIds);
      if (error) throw error;
      return data as ProductOrderItem[];
    },
  });

  const itemsByOrder = useMemo(() => {
    const map = new Map<string, ProductOrderItem[]>();
    for (const item of itemsQ.data ?? []) {
      const list = map.get(item.order_id) ?? [];
      list.push(item);
      map.set(item.order_id, list);
    }
    return map;
  }, [itemsQ.data]);

  const fulfill = useMutation({
    mutationFn: async (orderId: string) => {
      const token = await bearerToken();
      await postPublicApi("/api/public/product-order-fulfill", { order_id: orderId }, token);
    },
    onSuccess: () => {
      toast.success("Pedido marcado como entregue");
      qc.invalidateQueries({ queryKey: ["product-orders-pending-pickup", shopId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section>
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Pedidos aguardando retirada
      </h2>
      {ordersQ.data?.length === 0 && (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          Nenhum pedido aguardando retirada.
        </div>
      )}
      <div className="grid grid-cols-1 gap-2">
        {ordersQ.data?.map((o) => {
          const items = itemsByOrder.get(o.id) ?? [];
          return (
            <div key={o.id} className="surface flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{o.customer_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {items.map((i) => `${i.quantity}x ${i.product_title}`).join(", ") || "produto"}
                </p>
                <p className="text-xs text-muted-foreground">{fmtDateTime(o.created_at ?? "")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="brand-text font-bold">{brl(o.total_price)}</span>
                <Button size="sm" variant="hero" disabled={fulfill.isPending} onClick={() => fulfill.mutate(o.id)}>
                  <PackageCheck className="size-4" /> Entregue
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MinhasVendasProdutos({ barber }: { barber: Barber }) {
  const salesQ = useQuery({
    queryKey: ["my-product-sales", barber.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_orders")
        .select("*")
        .eq("barber_id", barber.id)
        .eq("payment_status", "pago")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProductOrder[];
    },
  });

  const orderIds = useMemo(() => (salesQ.data ?? []).map((o) => o.id), [salesQ.data]);

  const itemsQ = useQuery({
    queryKey: ["my-product-sale-items", barber.id, orderIds.join(",")],
    enabled: orderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("product_order_items").select("*").in("order_id", orderIds);
      if (error) throw error;
      return data as ProductOrderItem[];
    },
  });

  const itemsByOrder = useMemo(() => {
    const map = new Map<string, ProductOrderItem[]>();
    for (const item of itemsQ.data ?? []) {
      const list = map.get(item.order_id) ?? [];
      list.push(item);
      map.set(item.order_id, list);
    }
    return map;
  }, [itemsQ.data]);

  const pct = Number(barber.product_commission_percent) || 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Minhas vendas de produtos</h1>
        <p className="text-sm text-muted-foreground">
          Vendas presenciais de produto que você lançou pela Caixa. Sua comissão atual é de {pct}%.
        </p>
      </header>

      {salesQ.data?.length === 0 && (
        <div className="surface p-6 text-center text-sm text-muted-foreground">
          Você ainda não tem vendas de produto atribuídas.
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {salesQ.data?.map((o) => {
          const items = itemsByOrder.get(o.id) ?? [];
          const comissao = (Number(o.total_price) * pct) / 100;
          return (
            <div key={o.id} className="surface flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">{o.customer_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {items.map((i) => `${i.quantity}x ${i.product_title}`).join(", ") || "produto"}
                </p>
                <p className="text-xs text-muted-foreground">{fmtDateTime(o.created_at ?? "")}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold">{brl(o.total_price)}</p>
                <p className="text-xs text-muted-foreground">
                  {pct}% · <span className="brand-text font-semibold">{brl(comissao)}</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
