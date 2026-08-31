import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useSession, isClientAccount } from "@/hooks/use-auth";
import { BrandMark } from "@/components/Brand";

export const Route = createFileRoute("/b/$slug")({
  head: () => ({ meta: [{ title: "Entrar — VIP BARBER" }] }),
  component: BarbershopLinkPage,
});

function BarbershopLinkPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { session, loading: loadingSession } = useSession();
  const [status, setStatus] = useState<"loading" | "not_found">("loading");

  useEffect(() => {
    if (loadingSession) return;
    let cancelled = false;

    async function resolve() {
      const res = await fetch(`/api/public/barbershop-by-slug?slug=${encodeURIComponent(slug)}`, {
        cache: "no-store",
      }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { id?: string } | null;
      const barbershopId = body?.id;
      if (cancelled) return;

      if (!barbershopId) {
        setStatus("not_found");
        return;
      }

      if (!session) {
        // /auth lê o parâmetro direto de window.location.search (não usa o
        // search tipado do router), então montamos a URL exatamente como o
        // link/QR code antigo já fazia, pra não arriscar uma serialização
        // diferente do que essa página espera.
        window.location.href = `/auth?barbershop_id=${encodeURIComponent(barbershopId)}`;
        return;
      }

      if (isClientAccount(session)) {
        // Vínculo único e silencioso: quem já tem conta de cliente passa a
        // ficar ligado a esta barbearia, sem tela nem aviso — igual a se
        // sempre tivesse sido só desta.
        const current = (session.user.user_metadata as { barbershop_id?: string } | null)
          ?.barbershop_id;
        if (current !== barbershopId) {
          await supabase.auth.updateUser({ data: { barbershop_id: barbershopId } });
        }
        navigate({ to: "/" });
        return;
      }

      const { data: ownBarber } = await supabase
        .from("barbers")
        .select("id")
        .eq("user_id", session.user.id)
        .limit(1)
        .maybeSingle();
      navigate({ to: ownBarber ? "/painel" : "/" });
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [slug, session, loadingSession, navigate]);

  if (status === "not_found") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
        <BrandMark size={48} />
        <p className="text-sm text-muted-foreground">Link inválido ou barbearia não encontrada.</p>
      </main>
    );
  }

  // Essa tela é só uma passagem (resolve o slug e já redireciona sozinha
  // pro cadastro/login ou pra home) — nenhum banner deve ficar aqui, porque
  // o redirecionamento é quase instantâneo e qualquer aviso apareceria e
  // sumiria na hora, parecendo bug (foi o que aconteceu com o banner iOS,
  // por isso ele saiu daqui e ficou só na home). Quando o app Android
  // existir, o banner de download só deve entrar aqui se o redirecionamento
  // for pausado de propósito pra visitante Android — senão vai ter o mesmo
  // problema.
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-5 py-10">
      <Loader2 className="animate-spin text-muted-foreground" />
    </main>
  );
}
