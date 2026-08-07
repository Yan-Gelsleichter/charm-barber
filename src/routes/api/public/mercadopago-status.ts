import { createFileRoute } from "@tanstack/react-router";
import { mpPlatformCredentials, credentialEnv } from "@/lib/mp-platform.server";

/**
 * Informa (sem expor segredos) se a plataforma já tem as chaves do Mercado Pago
 * configuradas no Supabase. Usado pelo painel para mostrar "Conectado".
 */
export const Route = createFileRoute("/api/public/mercadopago-status")({
  server: {
    handlers: {
      GET: async () => {
        const creds = mpPlatformCredentials();
        return Response.json(
          {
            configured: !!creds,
            env: credentialEnv(creds?.accessToken),
            has_public_key: !!creds?.publicKey,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
