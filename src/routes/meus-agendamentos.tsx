import { useEffect } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Loader2, LogOut, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import type { Appointment, Barber, Service } from "@/integrations/supabase/db-types";
import { BrandMark } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtTime, brl, phoneDigits } from "@/lib/format";
import { cancellationMarkerName, cancellationMarkerTime, filterActiveAppointments } from "@/lib/availability";

export const Route = createFileRoute("/meus-agendamentos")({
  head: () => ({ meta: [{ title: "Meus agendamentos — VIP BARBER" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    cliente: s.cliente === "1" || s.cliente === true,
  }),
  component: MeusAgendamentosPage,
});

function MeusAgendamentosPage() {
  const navigate = useNavigate();
  const { cliente } = Route.useSearch();
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

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
    queryKey: ["my-appointments", uid, phone, email, metaName],
    enabled: !!uid,
    queryFn: async () => {
      // Encontra agendamentos por telefone (preferencial) ou pelo nome do usuário
      const orParts: string[] = [];
      if (phone) orParts.push(`customer_phone.eq.${phone}`);
      if (metaName) orParts.push(`customer_name.ilike.${metaName}`);
      if (orParts.length === 0) return { appointments: [] as Appointment[], barbersMap: new Map<string, Barber>(), servicesMap: new Map<string, Service>() };

      const { data: ap, error } = await supabase
        .from("appointments")
        .select("*")
        .or(orParts.join(","))
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

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const displayName = metaName || email || "Cliente";
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

  const past = appointments.filter((a) => new Date(a.appointment_time).getTime() < now);
  const latest = appointments[0]; // mais recente pela data do agendamento

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
      </header>

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
                  {s && <span className="brand-text font-bold">{brl(s.price)}</span>}
                </div>
                {isUpcoming && (
                  <div className="mt-3 flex justify-end gap-2">
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
          {upcoming.length === 0 && past.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              Último atendimento realizado.
            </p>
          )}
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
