import { createFileRoute } from "@tanstack/react-router";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/** Resolve slug -> id da barbearia. Não expõe nenhum dado sensível. */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

export const Route = createFileRoute("/api/public/barbershop-by-slug")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ request }) => {
        try {
          const slug = new URL(request.url).searchParams.get("slug")?.trim().toLowerCase();
          if (!slug) return json({ error: "Slug ausente." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const { data, error } = await admin
            .from("barbershops")
            .select("id")
            .eq("slug", slug)
            .maybeSingle();
          if (error) {
            console.error("Barbearia por slug: falha na busca", error);
            return json({ error: "Não foi possível localizar a barbearia." }, 500);
          }
          const id = (data as { id?: string } | null)?.id;
          if (!id) return json({ error: "Barbearia não encontrada." }, 404);

          return json({ id });
        } catch (error) {
          console.error("Barbearia por slug: erro inesperado", error);
          return json({ error: "Não foi possível localizar a barbearia." }, 500);
        }
      },
    },
  },
});
