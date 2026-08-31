import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { slugify } from "@/lib/slug";

/**
 * Gera (se ainda não existir) o slug de uma barbearia a partir do
 * `business_name` do admin, garantindo unicidade. Só quem é admin da
 * barbearia pode chamar isso.
 */

const requestSchema = z.object({
  barbershop_id: z.string().uuid(),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...CORS_HEADERS },
  });
}

export const Route = createFileRoute("/api/public/ensure-barbershop-slug")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) return json({ error: "É preciso estar logado." }, 401);
          const bearer = authorization.slice("Bearer ".length).trim();
          const { data: userData, error: authError } = await admin.auth.getUser(bearer);
          const user = userData.user;
          if (authError || !user) return json({ error: "Sessão inválida. Entre novamente." }, 401);

          const { data: adminBarber } = await admin
            .from("barbers")
            .select("business_name")
            .eq("barbershop_id", parsed.data.barbershop_id)
            .eq("user_id", user.id)
            .eq("is_admin", true)
            .maybeSingle();
          if (!adminBarber) {
            return json({ error: "Você não é admin dessa barbearia." }, 403);
          }

          const { data: shop, error: shopError } = await admin
            .from("barbershops")
            .select("slug")
            .eq("id", parsed.data.barbershop_id)
            .maybeSingle();
          if (shopError) {
            console.error("Slug da barbearia: falha ao buscar", shopError);
            return json({ error: "Não foi possível carregar a barbearia." }, 500);
          }
          const existing = (shop as { slug?: string | null } | null)?.slug;
          if (existing) return json({ slug: existing });

          const businessName =
            (adminBarber as { business_name?: string | null }).business_name?.trim() || "barbearia";
          const base = slugify(businessName) || "barbearia";

          let candidate = base;
          let suffix = 2;
          for (let i = 0; i < 30; i++) {
            const { data: taken } = await admin
              .from("barbershops")
              .select("id")
              .eq("slug", candidate)
              .maybeSingle();
            if (!taken) break;
            candidate = `${base}-${suffix}`;
            suffix += 1;
          }

          const { error: updateError } = await admin
            .from("barbershops")
            .update({ slug: candidate })
            .eq("id", parsed.data.barbershop_id);
          if (updateError) {
            console.error("Slug da barbearia: falha ao gravar", updateError);
            return json({ error: "Não foi possível gerar o link." }, 500);
          }

          return json({ slug: candidate });
        } catch (error) {
          console.error("Slug da barbearia: erro inesperado", error);
          return json({ error: "Não foi possível gerar o link." }, 500);
        }
      },
    },
  },
});
