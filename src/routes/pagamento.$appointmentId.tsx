import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { QrCode, Store, Loader2, Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { brl, fmtTime } from "@/lib/format";

type PixData = {
  payment_id: number | string;
  status: string;
  amount: number;
  qr_code: string | null;
  qr_code_base64: string | null;
  ticket_url: string | null;
};

async function callPixApi(body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Sua sessão expirou. Faça login novamente.");

  const response = await fetch("/api/public/mercadopago-pix", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string } & Partial<PixData>;
  if (!response.ok) throw new Error(data.error ?? "Falha ao processar o pagamento PIX.");
  return data;
}

export const Route = createFileRoute("/pagamento/$appointmentId")({
  head: () => ({
    meta: [
      { title: "Pagamento do agendamento" },
      {
        name: "description",
        content: "Pague seu agendamento por PIX instantâneo ou escolha pagar presencialmente na barbearia.",
      },
      { property: "og:title", content: "Pagamento do agendamento" },
      {
        property: "og:description",
        content: "Pague por PIX instantâneo ou presencialmente na barbearia.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PagamentoPage,
});

function PagamentoPage() {
  const { appointmentId } = Route.useParams();
  const navigate = useNavigate();
  const [pix, setPix] = useState<PixData | null>(null);
  const [paid, setPaid] = useState(false);

  const apptQ = useQuery({
    queryKey: ["appointment-pay", appointmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id, appointment_time, service_id, customer_name")
        .eq("id", appointmentId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const svc = await supabase
        .from("services")
        .select("id, name, price, duration_minutes")
        .eq("id", (data as { service_id: string }).service_id)
        .maybeSingle();
      return {
        appointment: data as { id: string; appointment_time: string; customer_name: string },
        service: svc.data as { name: string; price: number } | null,
      };
    },
  });

  const createPix = useMutation({
    mutationFn: async () => {
      const data = await callPixApi({ action: "create", appointment_id: appointmentId });
      if (!data.payment_id) throw new Error("O Mercado Pago não retornou os dados do PIX.");
      return data as PixData;
    },
    onSuccess: (d) => setPix(d),
    onError: (e: Error) => toast.error("Não foi possível gerar o PIX", { description: e.message }),
  });

  // Polling do status do pagamento enquanto o PIX estiver aberto.
  useEffect(() => {
    if (!pix?.payment_id || paid) return;
    const timer = setInterval(async () => {
      try {
        const data = await callPixApi({
          action: "status",
          payment_id: pix.payment_id,
          appointment_id: appointmentId,
        });
        if (data.status === "approved") {
          setPaid(true);
          clearInterval(timer);
          toast.success("Pagamento confirmado!");
          setTimeout(() => navigate({ to: "/meus-agendamentos" }), 1500);
        }
      } catch (error) {
        console.error("Falha ao consultar o pagamento PIX", error);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [pix, paid, appointmentId, navigate]);

  const service = apptQ.data?.service ?? null;
  const appointment = apptQ.data?.appointment ?? null;

  return (
    <main className="mx-auto max-w-md px-5 pb-24 pt-8">
      <h1 className="text-xl font-semibold">Pagamento</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Escolha como deseja pagar o seu atendimento.
      </p>

      <section className="surface mt-5 space-y-2 p-4 text-sm">
        {apptQ.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Serviço</span>
              <span className="font-medium">{service?.name ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Horário</span>
              <span className="font-medium">
                {appointment
                  ? `${new Date(appointment.appointment_time).toLocaleDateString("pt-BR")} · ${fmtTime(appointment.appointment_time)}`
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 pt-2">
              <span className="text-muted-foreground">Total</span>
              <span className="brand-text text-base font-bold">{brl(service?.price ?? 0)}</span>
            </div>
          </>
        )}
      </section>

      {paid && (
        <div className="surface mt-5 flex items-center gap-3 p-4 text-sm">
          <CheckCircle2 className="size-5 text-[color:var(--success)]" />
          Pagamento aprovado! Redirecionando…
        </div>
      )}

      {!pix && !paid && (
        <div className="mt-5 grid gap-3">
          <Button
            variant="hero"
            size="xl"
            className="w-full"
            onClick={() => createPix.mutate()}
            disabled={createPix.isPending}
          >
            {createPix.isPending ? <Loader2 className="animate-spin" /> : <QrCode />}
            Pagar agora com PIX
          </Button>
          <Button
            variant="outline"
            size="xl"
            className="w-full"
            onClick={() => {
              toast.success("Combinado! Pague presencialmente na barbearia.");
              navigate({ to: "/meus-agendamentos" });
            }}
          >
            <Store /> Pagar presencialmente
          </Button>
        </div>
      )}

      {pix && !paid && (
        <section className="surface mt-5 space-y-4 p-4 text-center">
          <p className="text-sm font-medium">Escaneie o QR Code no app do seu banco</p>
          {pix.qr_code_base64 && (
            <img
              src={`data:image/png;base64,${pix.qr_code_base64}`}
              alt="QR Code PIX"
              className="mx-auto h-56 w-56 rounded-xl bg-white p-2"
            />
          )}
          {pix.qr_code && (
            <>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                PIX copia e cola
              </p>
              <p className="max-h-24 overflow-auto break-all rounded-lg bg-secondary p-3 text-left font-mono text-[11px]">
                {pix.qr_code}
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  if (!pix.qr_code) return;
                  await navigator.clipboard.writeText(pix.qr_code);
                  toast.success("Código PIX copiado");
                }}
              >
                <Copy /> Copiar código
              </Button>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Aguardando confirmação do pagamento…
          </p>
          <Button variant="ghost" className="w-full" onClick={() => navigate({ to: "/meus-agendamentos" })}>
            Pagar depois / ver meus agendamentos
          </Button>
        </section>
      )}
    </main>
  );
}
