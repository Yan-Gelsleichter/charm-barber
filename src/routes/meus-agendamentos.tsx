import { useEffect } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Loader2, LogOut, Scissors } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import type { Appointment, Barber, Client, Service } from "@/integrations/supabase/db-types";
import { BrandMark } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtTime, brl } from "@/lib/format";

export const Route = createFileRoute("/meus-agendamentos")({
  head: () => ({ meta: [{ title: "Meus agendamentos — VIP BARBER" }] }),
  component: MeusAgendamentosPage,
});

function MeusAgendamentosPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const uid = session?.user.id ?? null;
  const email = session?.user.email ?? null;
  const metaName = (session?.user.user_metadata?.name || session?.user.user_metadata?.full_name) as
    | string
    | undefined;

  // Busca registros de cliente vinculados a esse usuário (por user_id ou por e-mail).
  const clientsQ = useQuery({
    queryKey: ["me-clients", uid, email],
    enabled: !!uid,
    queryFn: async (): Promise<Client[]> => {
      const results: Record<string, Client> = {};
      const { data: byUser } = await supabase
        .from("clients")
        .select("*")
        .eq("user_id", uid!);
      (byUser ?? []).forEach((c) => (results[c.id] = c as Client));
      if (email) {
        const { data: byEmail } = await supabase
          .from("clients")
          .select("*")
          .ilike("email", email);
        for (const c of byEmail ?? []) {
          const row = c as Client;
          results[row.id] = row;
          // vincula automaticamente ao user_id se ainda não estiver
          if (!row.user_id) {
            await supabase.from("clients").update({ user_id: uid }).eq("id", row.id);
            row.user_id = uid;
          }
        }
      }
      return Object.values(results);
    },
  });

  const clients = clientsQ.data ?? [];
  const barberIds = Array.from(new Set(clients.map((c) => c.barber_id)));

  const dataQ = useQuery({
    queryKey: ["my-appointments", uid, barberIds.join(",")],
    enabled: !!uid && barberIds.length > 0,
    queryFn: async () => {
      const phones = clients.map((c) => c.whatsapp).filter(Boolean) as string[];
      const names = clients.map((c) => c.name);
      const nowIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const [apRes, brRes, svRes] = await Promise.all([
        supabase
          .from("appointments")
          .select("*")
          .in("barber_id", barberIds)
          .gte("appointment_time", nowIso)
          .order("appointment_time"),
        supabase.from("barbers").select("*").in("id", barberIds),
        supabase.from("services").select("*").in("barber_id", barberIds),
      ]);
      if (apRes.error) throw apRes.error;
      if (brRes.error) throw brRes.error;
      if (svRes.error) throw svRes.error;

      const appointments = (apRes.data as Appointment[]).filter(
        (a) =>
          (a.customer_phone && phones.includes(a.customer_phone)) ||
          names.includes(a.customer_name),
      );
      const barbersMap = new Map((brRes.data as Barber[]).map((b) => [b.id, b]));
      const servicesMap = new Map((svRes.data as Service[]).map((s) => [s.id, s]));
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

  const displayName = clients[0]?.name || metaName || email || "Cliente";
  const primaryClient = clients[0];

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
        <p className="text-sm text-muted-foreground">
          Seus horários confirmados nas próximas semanas.
        </p>
      </section>

      {clientsQ.isLoading || dataQ.isLoading ? (
        <div className="surface mt-6 flex items-center justify-center p-10">
          <Loader2 className="animate-spin" />
        </div>
      ) : clients.length === 0 ? (
        <div className="surface mt-6 space-y-4 p-6 text-center">
          <Scissors className="mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Ainda não localizamos seu cadastro em nenhuma barbearia com o e-mail{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </p>
          <p className="text-xs text-muted-foreground">
            Peça ao seu barbeiro para te cadastrar com este e-mail, ou escolha um profissional abaixo para
            marcar um horário.
          </p>
          <Button asChild variant="hero">
            <Link to="/">
              <CalendarDays /> Ver barbeiros
            </Link>
          </Button>
        </div>
      ) : (dataQ.data?.appointments.length ?? 0) === 0 ? (
        <div className="surface mt-6 space-y-4 p-6 text-center">
          <CalendarDays className="mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Você não tem agendamentos futuros. Que tal marcar um?
          </p>
          <Button asChild variant="hero">
            <Link
              to={primaryClient ? "/agendar/$barbeiroId" : "/"}
              params={primaryClient ? { barbeiroId: primaryClient.barber_id } : undefined}
            >
              Agendar agora
            </Link>
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-3">
          {dataQ.data!.appointments.map((a) => {
            const b = dataQ.data!.barbersMap.get(a.barber_id);
            const s = dataQ.data!.servicesMap.get(a.service_id);
            const d = new Date(a.appointment_time);
            return (
              <div key={a.id} className="surface flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold">{s?.name ?? "Serviço"}</p>
                  <p className="text-xs text-muted-foreground">
                    com {b?.name ?? "barbeiro"} • {b?.business_name ?? ""}
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="brand-text font-semibold">{fmtDate(d)}</span> às{" "}
                    <span className="font-semibold">{fmtTime(d)}</span>
                  </p>
                </div>
                {s && <span className="brand-text font-bold">{brl(s.price)}</span>}
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
