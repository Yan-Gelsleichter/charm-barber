import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ArrowLeft, Clock, Store } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { ProductOrderItem } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pedido-confirmado/$orderId")({
  head: () => ({ meta: [{ title: "Pedido — APP BARBEARIAS" }] }),
  component: PedidoConfirmadoPage,
});

function PedidoConfirmadoPage() {
  const { orderId } = Route.useParams();

  const q = useQuery({
    queryKey: ["product-order-confirmation", orderId],
    staleTime: 0,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_orders")
        .select("id, payment_status")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; payment_status: string } | null;
    },
  });

  const status = q.data?.payment_status;
  const isPago = status === "pago";

  const itemsQ = useQuery({
    queryKey: ["product-order-confirmation-items", orderId],
    enabled: isPago,
    queryFn: async () => {
      const { data, error } = await supabase.from("product_order_items").select("*").eq("order_id", orderId);
      if (error) throw error;
      return data as ProductOrderItem[];
    },
  });

  return (
    <main className="mx-auto max-w-md px-5 pb-24 pt-6">
      <Button asChild variant="ghost" size="sm" className="mb-6 -ml-2">
        <Link to="/">
          <ArrowLeft /> Início
        </Link>
      </Button>

      <div className="surface p-8 text-center">
        {q.isLoading ? (
          <Loader2 className="mx-auto animate-spin" />
        ) : isPago ? (
          <CheckCircle2 className="mx-auto size-12 text-success" />
        ) : (
          <Clock className="mx-auto size-12 text-muted-foreground" />
        )}
        <h1 className="mt-4 text-lg font-semibold">
          {isPago ? "Pagamento confirmado!" : "Processando pagamento…"}
        </h1>
        {!isPago && (
          <p className="mt-2 text-sm text-muted-foreground">
            Isso costuma levar só alguns segundos. Não feche esta página.
          </p>
        )}
      </div>

      {isPago && (
        <div className="surface mt-4 space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Store className="size-5 text-primary" />
            <p className="font-semibold">Retirar na barbearia</p>
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {itemsQ.data?.map((item) => (
              <li key={item.id}>
                {item.quantity}x {item.product_title}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Você vai ser avisado quando puder buscar — geralmente já está pronto.
          </p>
        </div>
      )}

      <Button asChild variant="hero" className="mt-6 w-full">
        <Link to="/meus-agendamentos">Ver meus pedidos</Link>
      </Button>
    </main>
  );
}
