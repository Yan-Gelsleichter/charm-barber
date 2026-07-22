import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Scissors, Calendar, LogOut, CalendarDays, LayoutDashboard, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Barber } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { BrandTitle, BrandMark } from "@/components/Brand";
import { useMeBarber } from "@/hooks/use-auth";
import { useShopConfig } from "@/hooks/use-shop";
import { useApplyPrimaryColor } from "@/lib/theme";
import { getMyBarbershopId } from "@/lib/barbershop";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VIP BARBER — Agende seu corte" },
      {
        name: "description",
        content: "Escolha seu barbeiro favorito e agende em poucos toques.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const { session, barber, loading } = useMeBarber();
  const shopIdQ = useQuery({
    queryKey: ["current-barbershop-id", session?.user.id ?? null, barber?.barbershop_id ?? null],
    enabled: !!session,
    queryFn: async () => barber?.barbershop_id ?? (await getMyBarbershopId()),
  });
  const currentBarbershopId = barber?.barbershop_id ?? shopIdQ.data ?? null;
  const { data: shop } = useShopConfig(currentBarbershopId);
  useApplyPrimaryColor(shop?.primary_color ?? null);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const { data: barbers, isLoading } = useQuery({
    queryKey: ["barbers-list", currentBarbershopId],
    enabled: !!session && shopIdQ.isSuccess && !!currentBarbershopId,
    queryFn: async (): Promise<Barber[]> => {
      const { data, error } = await supabase
        .from("barbers")
        .select("*")
        .eq("barbershop_id", currentBarbershopId!)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Barber[];
    },
  });

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {shop?.logo_url ? (
            <img
              src={shop.logo_url}
              alt={shop.business_name ?? "logo"}
              className="h-10 w-10 rounded-xl object-cover"
            />
          ) : (
            <BrandMark size={40} />
          )}
          <div className="leading-tight">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Bem-vindo
            </p>
            <p className="brand-text text-lg font-semibold">
              {session.user.user_metadata?.name || session.user.email}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {barber ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/painel">
                <LayoutDashboard /> Painel
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link to="/meus-agendamentos">
                <CalendarDays /> Meus
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut />
          </Button>
        </div>
      </header>


      <section className="mt-10 text-center">
        <BrandTitle />
        <p className="mt-3 text-base text-muted-foreground">
          Escolha seu barbeiro e agende em poucos toques.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 px-1 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Profissionais
        </h2>

        {(isLoading || shopIdQ.isLoading) && (
          <div className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="surface h-24 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && !shopIdQ.isLoading && (!currentBarbershopId || !barbers || barbers.length === 0) && (
          <div className="surface p-8 text-center">
            <Scissors className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhum barbeiro cadastrado ainda.
            </p>
          </div>
        )}

        <div className="grid gap-3">
          {barbers?.map((b) => (
            <Link
              key={b.id}
              to="/agendar/$barbeiroId"
              params={{ barbeiroId: b.id }}
              className="surface group flex items-center gap-4 p-4 transition-all hover:border-transparent hover:shadow-[var(--shadow-elev)]"
            >
              <div className="brand-gradient flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-lg font-bold text-white">
                {b.avatar_url || b.logo_url ? (
                  <img src={b.avatar_url ?? b.logo_url ?? ""} alt={b.name} className="h-full w-full object-cover" />
                ) : shop?.logo_url ? (
                  <img src={shop.logo_url} alt={b.name} className="h-full w-full object-cover" />
                ) : (
                  b.name.charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{b.name}</p>
                <p className="text-xs text-muted-foreground">Toque para agendar</p>
              </div>
              <Calendar className="text-muted-foreground transition-transform group-hover:translate-x-1" />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
