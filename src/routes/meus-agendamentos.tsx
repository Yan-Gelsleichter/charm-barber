import { useEffect } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CreditCard, Loader2, LogOut, RefreshCw, X, Repeat } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import type { Appointment, Barber, Service } from "@/integrations/supabase/db-types";
import { BrandMark } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtTime, brl, phoneDigits } from "@/lib/format";
import { cancellationMarkerName, cancellationMarkerTime, filterActiveAppointments } from "@/lib/availability";
import { PaymentBadge } from "@/components/PaymentBadge";
import { postPublicApi } from "@/lib/api-fetch";

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando confirmação",
  authorized: "Cartão autorizado",
  active: "Ativa",
  paused: "Pausada",
  payment_failed: "Última cobrança falhou",
};

export const Route = createFileRoute("/meus-agendamentos")({
  head: () => ({ meta: [{ title: "Meus agendamentos — VIP BARBER" }] }),
  validateSearch: (s: Record<string, unknown>): { cliente?: boolean; agendamento?: string } => ({
    cliente: s.cliente === "1" || s.cliente === true,
    agendamento: typeof s.agendamento === "string" && s.agendamento ? s.agendamento : undefined,
  }),
  component: MeusAgendamentosPage,
});

function MeusAgendamentosPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { cliente, agendamento: guestId } = Route.useSearch();
  const { session, loading } = useSession();
  // ADICIONE ESTE BLOCO AQUI: Força a atualização automática dos dados assim que a tela abre ou ganha foco
  useEffect(() => {
    const handleFocus = () => {
      void dataQ.refetch();
    };
    window.addEventListener("focus", handleFocus);
    // Dispara uma busca imediata ao carregar a página para garantir o status atualizado
    void dataQ.refetch();
    return () => window.removeEventListener("focus", handleFocus);
  }, []);
  useEffect(() => {
    if (!loading && !session && !guestId) navigate({ to: "/auth" });
  }, [loading, session, guestId, navigate]);

  useEffect(() => {
    if (!cliente || !session) return;
    void supabase.auth.updateUser({ data: { account_type: "client" } });
    void supabase.from("barbers").delete().eq("user_id", session.user.id);
  }, [cliente, session]);

  const uid = session?.user.id ?? null;
  const email = session?.user.email ?? null;
  const meta = (session?.user.user_metadata ?? {}) as Record<string, string | undefined>;
  const metaName = (meta.name || meta.full_name) as string | undefined;
  const phone = phoneDigits(meta.whatsapp_digits || meta.whatsapp || "");

  const dataQ = useQuery({
    queryKey: ["my-appointments", uid, phone, email, metaName, guestId ?? null],
    enabled: !!uid || !!guestId,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const empty = {
        appointments: [] as Appointment[],
        barbersMap: new Map<string, Barber>(),
        servicesMap: new Map<string, Service>(),
      };

      // Convidado (sem login): busca pelo agendamento recém-criado e pelos do mesmo telefone.
      if (!uid && guestId) {
        const { data: one } = await supabase
          .from("appointments")
          .select("*")
          .eq("id", guestId)
          .maybeSingle();
        const base = one as Appointment | null;
        if (!base) return empty;
        let list: Appointment[] = [base];
        if (base.customer_phone) {
          const { data: same } = await supabase
            .from("appointments")
            .select("*")
            .eq("customer_phone", base.customer_phone)
            .order("appointment_time", { ascending: false })
            .limit(50);
          const rows = (same ?? []) as Appointment[];
          if (rows.length) list = rows;
        }
        const barberIds = Array.from(new Set(list.map((a) => a.barber_id)));
        const serviceIds = Array.from(new Set(list.map((a) => a.service_id)));
        const [br, sv] = await Promise.all([
          supabase.from("barbers").select("*").in("id", barberIds),
          supabase.from("services").select("*").in("id", serviceIds),
        ]);
        return {
          appointments: list,
          barbersMap: new Map(((br.data ?? []) as Barber[]).map((b) => [b.id, b])),
          servicesMap: new Map(((sv.data ?? []) as Service[]).map((s2) => [s2.id, s2])),
        };
      }

      // Encontra agendamentos por telefone (preferencial) ou pelo nome do usuário
      const orParts: string[] = [];
      if (phone) orParts.push(`customer_phone.eq.${phone}`);
      if (metaName) orParts.push(`customer_name.ilike.${metaName}`);
      if (orParts.length === 0) return empty;

      // Cada cliente fica vinculado a uma única barbearia por vez — sem essa
      // trava, alguém que já teve conta em outra barbearia (identificado
      // pelo mesmo telefone/nome) veria agendamentos misturados aqui.
      const { getMyBarbershopId } = await import("@/lib/barbershop");
      const currentShopId = await getMyBarbershopId().catch(() => null);

      let query = supabase.from("appointments").select("*").or(orParts.join(","));
      if (currentShopId) query = query.eq("barbershop_id", currentShopId);

      const { data: ap, error } = await query
        .order("appointment_time", { ascending: false })
        .limit(50);
      if (error) throw error;

      const appointments = (ap ?? []) as Appointment[];
      const barberIds = Array.from(new Set(appointments.map((a) => a.barber_id)));
      const serviceIds = Array.from(new Set(appointments.map((a) => a.service_id)));

      const [brRes, svRes] = await Promise.all([
        barberIds.length
          ? supabase.from("barbers").select("*").in("id", barberIds)
          : Promise.resolve({ data: [] as Barber[], error: null }),
        serviceIds.length
          ? supabase.from("services").select("*").in("id", serviceIds)
          : Promise.resolve({ data: [] as Service[], error: null }),
      ]);

      const barbersMap = new Map(((brRes.data ?? []) as Barber[]).map((b) => [b.id, b]));
      const servicesMap = new Map(((svRes.data ?? []) as Service[]).map((s) => [s.id, s]));
      return { appointments, barbersMap, servicesMap };
    },
  });

  const subscriptionsQ = useQuery({
    queryKey: ["my-subscriptions", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data: myClients } = await supabase.from("clients").select("id").eq("user_id", uid!);
      const clientIds = ((myClients ?? []) as { id: string }[]).map((c) => c.id);
      if (clientIds.length === 0) return { subs: [], planNameById: new Map<string, string>() };

      const { data: subs, error } = await supabase
        .from("client_subscriptions")
        .select("*")
        .in("client_id", clientIds)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const list = (subs ?? []) as { id: string; plan_id: string; status: string; current_period_end: string | null }[];
      const planIds = Array.from(new Set(list.map((s) => s.plan_id)));
      const planNameById = new Map<string, string>();
      if (planIds.length > 0) {
        const { data: plans } = await supabase.from("subscription_plans").select("id, name").in("id", planIds);
        ((plans ?? []) as { id: string; name: string }[]).forEach((p) => planNameById.set(p.id, p.name));
      }
      return { subs: list, planNameById };
    },
  });

  const cancelSubscription = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const token = session?.access_token;
      await postPublicApi("/api/public/mercadopago-subscription-cancel", { subscription_id: subscriptionId }, token);
    },
    onSuccess: () => {
      toast.success("Assinatura cancelada");
      qc.invalidateQueries({ queryKey: ["my-subscriptions", uid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading || (!session && !guestId)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const guestName = dataQ.data?.appointments[0]?.customer_name ?? null;
  const displayName = metaName || email || guestName || "Cliente";
  async function cancelAppointment(appointment: Appointment) {
    const { data: updated, error: updateError } = await supabase
      .from("appointments")
      .update({ status: "cancelado" })
      .eq("id", appointment.id)
      .eq("customer_phone", phone)
      .select("id")
      .maybeSingle();

    if (updateError) throw updateError;
    if (updated) return;

    const { error: markerError } = await supabase.from("appointments").insert({
      barber_id: appointment.barber_id,
      service_id: appointment.service_id,
      customer_name: cancellationMarkerName(appointment.id, appointment.customer_name),
      customer_phone: appointment.customer_phone,
      appointment_time: cancellationMarkerTime(appointment.appointment_time),
      status: "cancelado",
    });
    if (markerError) throw markerError;
  }

  const appointments = filterActiveAppointments(dataQ.data?.appointments ?? []);
  const now = Date.now();
  const upcoming = appointments.filter((a) => new Date(a.appointment_time).getTime() >= now).slice().reverse();


  return (
    <div className="mx-auto max-w-2xl px-5 pb-16 pt-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <div className="leading-tight">
            <p className="text-xs text-muted-foreground">Olá,</p>
            <p className="font-semibold">{displayName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {session && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth" });
            }}
          >
            <LogOut /> Sair
          </Button>
          )}
        </div>
      </header>


      {session && subscriptionsQ.data && subscriptionsQ.data.subs.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Minha assinatura
          </h2>
          <div className="grid grid-cols-1 gap-2">
            {subscriptionsQ.data.subs.map((s) => (
              <div key={s.id} className="surface flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Repeat className="size-5 text-success" />
                  <div>
                    <p className="font-semibold">{subscriptionsQ.data.planNameById.get(s.plan_id) ?? "Plano"}</p>
                    <p className="text-xs text-muted-foreground">
                      {SUBSCRIPTION_STATUS_LABEL[s.status] ?? s.status}
                      {s.current_period_end &&
                        ` • próxima cobrança ${new Date(s.current_period_end).toLocaleDateString("pt-BR")}`}
                    </p>
                  </div>
                </div>
                {(s.status === "active" || s.status === "authorized") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => confirm("Cancelar sua assinatura?") && cancelSubscription.mutate(s.id)}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h1 className="text-xl font-semibold">Meus agendamentos</h1>
        <p className="text-sm text-muted-foreground">Seu último agendamento realizado.</p>
      </section>

      {dataQ.isLoading ? (
        <div className="surface mt-6 flex items-center justify-center p-10">
          <Loader2 className="animate-spin" />
        </div>
      ) : upcoming.length === 0 ? (
        <div className="surface mt-6 p-6 text-center">
          <Button asChild variant="hero">
            <Link to="/">
              <CalendarDays /> Ver barbeiros
            </Link>
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-3">
          {upcoming.map((a) => {
            const b = dataQ.data!.barbersMap.get(a.barber_id);
            const s = dataQ.data!.servicesMap.get(a.service_id);
            const d = new Date(a.appointment_time);
            const isUpcoming = d.getTime() >= now;
            return (
              <div key={a.id} className="surface p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{s?.name ?? "Serviço"}</p>
                    <p className="text-xs text-muted-foreground">
                      com {b?.name ?? "barbeiro"} {b?.business_name ? `• ${b.business_name}` : ""}
                    </p>
                    <p className="mt-1 text-sm">
                      <span className="brand-text font-semibold">{fmtDate(d)}</span> às{" "}
                      <span className="font-semibold">{fmtTime(d)}</span>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <PaymentBadge status={a.payment_status} compact />
                    {s && <span className="brand-text font-bold">{brl(s.price)}</span>}
                  </div>
                </div>
                {isUpcoming && (
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {a.payment_status !== "pago" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate({
                            to: "/pagamento/$appointmentId",
                            params: { appointmentId: a.id },
                          })
                        }
                      >
                        <CreditCard /> Pagar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const ok = window.confirm(
                          "Deseja remarcar este agendamento? O horário atual será liberado.",
                        );
                        if (!ok) return;
                        navigate({
                          to: "/agendar/$barbeiroId",
                          params: { barbeiroId: a.barber_id },
                          search: {
                            remarcar: a.id,
                            servico: a.service_id,
                            data: a.appointment_time.slice(0, 10),
                          },
                        });
                      }}
                    >
                      <RefreshCw /> Remarcar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const ok = window.confirm(
                          "Deseja cancelar este atendimento? Esta ação não pode ser desfeita.",
                        );
                        if (!ok) return;
                        try {
                          await cancelAppointment(a);
                          await dataQ.refetch();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Não foi possível cancelar");
                        }
                      }}
                    >
                      <X /> Cancelar
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 text-center">
        <Button asChild variant="outline">
          <Link to="/">
            <CalendarDays /> Marcar novo horário
          </Link>
        </Button>
      </div>
    </div>
  );
}
