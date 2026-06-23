import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarDays,
  Scissors,
  Clock4,
  Users,
  History,
  LogOut,
  Loader2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useMeBarber } from "@/hooks/use-auth";
import { BrandMark } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { DashboardTab } from "@/painel/Dashboard";
import { AgendaTab } from "@/painel/Agenda";
import { ServicosTab } from "@/painel/Servicos";
import { HorariosTab } from "@/painel/Horarios";
import { BarbeirosTab } from "@/painel/Barbeiros";
import { HistoricoTab } from "@/painel/Historico";

type Tab =
  | "dashboard"
  | "agenda"
  | "servicos"
  | "horarios"
  | "barbeiros"
  | "historico";

const NAV: { id: Tab; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: "dashboard", label: "Painel", icon: LayoutDashboard },
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "servicos", label: "Serviços", icon: Scissors },
  { id: "horarios", label: "Horários", icon: Clock4 },
  { id: "historico", label: "Histórico", icon: History },
  { id: "barbeiros", label: "Barbeiros", icon: Users, adminOnly: true },
];

export const Route = createFileRoute("/painel")({
  head: () => ({ meta: [{ title: "Painel — VIP BARBER" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (s.tab as Tab) || ("dashboard" as Tab),
  }),
  component: PainelPage,
});

function PainelPage() {
  const navigate = useNavigate();
  const loc = useLocation();
  const { tab } = Route.useSearch();
  const { session, barber, loading } = useMeBarber();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  if (!barber) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <BrandMark size={48} />
        <h1 className="mt-4 text-xl font-semibold">Sua conta não está vinculada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Peça ao administrador para cadastrar você como barbeiro com este e-mail (
          <span className="brand-text">{session.user.email}</span>).
        </p>
        <Button
          className="mt-6"
          variant="outline"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/auth" });
          }}
        >
          <LogOut /> Sair
        </Button>
      </div>
    );
  }

  const items = NAV.filter((n) => !n.adminOnly || barber.is_admin);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandMark size={36} />
            <div className="leading-tight">
              <p className="text-xs text-muted-foreground">Olá,</p>
              <p className="font-semibold">{barber.name}</p>
            </div>
            {barber.is_admin && (
              <span className="brand-gradient ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                Admin
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={signingOut}>
            <LogOut /> Sair
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {tab === "dashboard" && <DashboardTab barber={barber} />}
        {tab === "agenda" && <AgendaTab barber={barber} />}
        {tab === "servicos" && <ServicosTab barber={barber} />}
        {tab === "horarios" && <HorariosTab barber={barber} />}
        {tab === "historico" && <HistoricoTab barber={barber} />}
        {tab === "barbeiros" && barber.is_admin && <BarbeirosTab />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-around px-2 py-2">
          {items.map((n) => {
            const active = tab === n.id;
            const Icon = n.icon;
            return (
              <Link
                key={n.id}
                to="/painel"
                search={{ tab: n.id }}
                replace
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors",
                  active
                    ? "brand-text"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className={cn("size-5", active && "drop-shadow-[0_0_8px_var(--brand-from)]")} />
                {n.label}
              </Link>
            );
          })}
        </div>
        <div style={{ height: "env(safe-area-inset-bottom)" }} />
        <span className="hidden">{loc.pathname}</span>
      </nav>
    </div>
  );
}
