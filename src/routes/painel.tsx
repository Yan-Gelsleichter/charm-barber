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
  Copy,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useMeBarber } from "@/hooks/use-auth";
import { useShopConfig } from "@/hooks/use-shop";
import { useApplyPrimaryColor } from "@/lib/theme";
import { BrandMark } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { DashboardTab } from "@/painel/Dashboard";
import { AgendaTab } from "@/painel/Agenda";
import { ServicosTab } from "@/painel/Servicos";
import { HorariosTab } from "@/painel/Horarios";
import { BarbeirosTab } from "@/painel/Barbeiros";
import { HistoricoTab } from "@/painel/Historico";
import { ClientesTab } from "@/painel/Clientes";
import { PerfilTab } from "@/painel/Perfil";

type Tab =
  | "dashboard"
  | "agenda"
  | "servicos"
  | "horarios"
  | "barbeiros"
  | "clientes"
  | "perfil"
  | "historico";

const NAV: { id: Tab; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: "dashboard", label: "Painel", icon: LayoutDashboard },
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "clientes", label: "Clientes", icon: UserRound, adminOnly: true },
  { id: "servicos", label: "Serviços", icon: Scissors },
  { id: "horarios", label: "Horários", icon: Clock4 },
  { id: "historico", label: "Histórico", icon: History },
  { id: "barbeiros", label: "Barbeiros", icon: Users, adminOnly: true },
  { id: "perfil", label: "Perfil", icon: UserRound },
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
  const { session, barber, loading, error, refetchBarber } = useMeBarber();
  const [signingOut, setSigningOut] = useState(false);
  const { data: shop } = useShopConfig(barber?.barbershop_id ?? null);
  const shopLogo = barber?.logo_url ?? shop?.logo_url ?? null;
  const shopName = shop?.business_name ?? barber?.business_name ?? null;
  useApplyPrimaryColor(barber?.primary_color ?? shop?.primary_color ?? null);

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
    const currentEmail = session.user.email || "sem e-mail";
    const currentUid = session.user.id;
    const adminName = String(
      session.user.user_metadata?.name || currentEmail.split("@")[0] || "Admin",
    ).replaceAll("'", "''");
    const linkSql = `-- Cole este bloco inteiro no SQL Editor do MESMO projeto conectado ao app.
-- Ele corrige visibilidade/RLS da tabela barbers e libera admin para o UID logado.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.barbers
    WHERE user_id = auth.uid()
      AND is_admin = true
  );
$$;

GRANT SELECT ON public.barbers TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.barbers TO authenticated;
GRANT ALL ON public.barbers TO service_role;

ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS barbers_select_all ON public.barbers;
DROP POLICY IF EXISTS barbers_insert_admin ON public.barbers;
DROP POLICY IF EXISTS barbers_update_own ON public.barbers;
DROP POLICY IF EXISTS barbers_delete_admin ON public.barbers;

CREATE POLICY barbers_select_all ON public.barbers
  FOR SELECT USING (true);

CREATE POLICY barbers_insert_admin ON public.barbers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY barbers_update_own ON public.barbers
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY barbers_delete_admin ON public.barbers
  FOR DELETE TO authenticated
  USING (public.is_admin());

DO $$
BEGIN
  UPDATE public.barbers
  SET name = '${adminName}',
      is_admin = true
  WHERE user_id = '${currentUid}';

  IF NOT FOUND THEN
    INSERT INTO public.barbers (id, user_id, name, is_admin)
    VALUES (gen_random_uuid(), '${currentUid}', '${adminName}', true);
  END IF;
END $$;

SELECT id, name, user_id, is_admin
FROM public.barbers
WHERE user_id = '${currentUid}';`;

    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <BrandMark size={48} />
        <h1 className="mt-4 text-xl font-semibold">Sua conta não está vinculada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ainda não encontrei um registro em <span className="brand-text">barbers</span> para este login.
          Rode o SQL abaixo e depois atualize o acesso.
        </p>
        <div className="surface mt-5 text-left">
          <p className="mb-4 rounded-lg border border-brand-from/30 bg-brand-from/10 p-3 text-xs text-muted-foreground">
            Você está conectado como <span className="font-semibold text-foreground">{currentEmail}</span>. Se
            o e-mail correto for outro, saia e entre/crie a conta com o e-mail certo antes de rodar o SQL.
          </p>
          {error && (
            <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              Erro ao consultar barbers: {error.message}
            </p>
          )}
          <p className="text-xs font-medium uppercase text-muted-foreground">E-mail</p>
          <p className="mt-1 break-all text-xs">{currentEmail}</p>
          <p className="text-xs font-medium uppercase text-muted-foreground">Seu UID</p>
          <p className="mt-1 break-all font-mono text-xs">{currentUid}</p>
          <p className="mt-4 text-xs font-medium uppercase text-muted-foreground">
            SQL para liberar admin
          </p>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-secondary p-3 text-xs text-secondary-foreground">
            {linkSql}
          </pre>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(linkSql);
                toast.success("SQL copiado");
              }}
            >
              <Copy /> Copiar SQL
            </Button>
            <Button
              variant="hero"
              onClick={async () => {
                await refetchBarber();
                toast.success("Acesso verificado");
              }}
            >
              <RefreshCw /> Atualizar acesso
            </Button>
          </div>
        </div>
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
            {shopLogo ? (
              <img
                src={shopLogo}
                alt={shopName ?? "logo"}
                className="h-9 w-9 rounded-xl object-cover"
              />
            ) : (
              <BrandMark size={36} />
            )}
            <div className="leading-tight">
              <p className="text-xs text-muted-foreground">
                {shopName ? shopName : "Olá,"}
              </p>
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
        {tab === "clientes" && barber.is_admin && <ClientesTab barber={barber} />}
        {tab === "perfil" && <PerfilTab barber={barber} email={session.user.email ?? null} />}


      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto max-w-5xl overflow-x-auto">
          <div className="flex min-w-max items-center gap-1 px-2 py-2">
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
                    "flex min-w-[64px] flex-col items-center gap-1 rounded-xl px-3 py-2 text-[11px] font-medium transition-colors",
                    active
                      ? "text-[var(--brand-from)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-5", active && "drop-shadow-[0_0_8px_var(--brand-from)]")} />
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div style={{ height: "env(safe-area-inset-bottom)" }} />
        <span className="hidden">{loc.pathname}</span>
      </nav>
    </div>
  );
}
