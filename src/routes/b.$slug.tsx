import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useSession, isClientAccount } from "@/hooks/use-auth";
import { BrandMark } from "@/components/Brand";
import { IosAddToHomeBanner } from "@/components/IosAddToHomeBanner";

const PLAY_STORE_URL = (import.meta.env.VITE_PLAY_STORE_URL ?? "").trim();

function isAndroidVisitor(): boolean {
  return typeof navigator !== "undefined" && /Android/.test(navigator.userAgent);
}

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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-5 py-10">
      <Loader2 className="animate-spin text-muted-foreground" />
      {isAndroidVisitor() && PLAY_STORE_URL && (
        <div className="surface w-full space-y-2 p-4 text-center">
          <p className="text-sm font-semibold">Tenha o app no seu Android</p>
          <a
            href={`${PLAY_STORE_URL}${PLAY_STORE_URL.includes("?") ? "&" : "?"}referrer=${encodeURIComponent(slug)}`}
            className="brand-text text-sm font-semibold underline-offset-2 hover:underline"
          >
            Baixar na Play Store
          </a>
        </div>
      )}
      <IosAddToHomeBanner />
    </main>
  );
}
