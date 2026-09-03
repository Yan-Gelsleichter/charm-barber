import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Cria uma barbearia nova + a conta de admin dela, pro cadastro
 * self-service em /comecar. A conta de autenticação já existe (criada
 * antes, via supabase.auth.signUp no navegador) — aqui só provisionamos o
 * tenant, sempre com service role: não existe política de RLS pra criar
 * a primeira linha de admin de uma conta nova (barbers_insert_admin exige
 * já SER admin — problema do ovo e da galinha), e barbershops não tem
 * INSERT liberado pra ninguém de fora do servidor.
 */

const TRIAL_DAYS = 7;

const requestSchema = z.object({
  name: z.string().trim().min(2),
  business_name: z.string().trim().min(2),
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

// Feature nova: mostra o motivo real do erro (não só uma mensagem genérica)
// enquanto ainda estamos validando o schema de `barbershops`, que não é
// versionado neste repositório.
function databaseError(prefix: string, error: { message: string; details?: string | null; hint?: string | null; code?: string | null }) {
  const extra = [error.details, error.hint, error.code ? `código ${error.code}` : null]
    .filter(Boolean)
    .join(" · ");
  return `${prefix}: ${error.message}${extra ? ` (${extra})` : ""}`;
}

export const Route = createFileRoute("/api/public/create-barbershop")({
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

          // Uma conta só pode criar/administrar uma barbearia por esse fluxo.
          const { data: existingBarber } = await admin
            .from("barbers")
            .select("id")
            .eq("user_id", user.id)
            .limit(1)
            .maybeSingle();
          if (existingBarber) {
            return json({ error: "Esta conta já tem uma barbearia cadastrada." }, 400);
          }

          const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 3_600_000).toISOString();
          const shopInsert = await admin
            .from("barbershops")
            .insert({
              name: parsed.data.business_name,
              subscription_status: "trial",
              trial_ends_at: trialEndsAt,
            })
            .select("id")
            .single();
          if (shopInsert.error || !shopInsert.data) {
            console.error("[create-barbershop] falha ao criar barbearia", shopInsert.error);
            const message = shopInsert.error
              ? databaseError("Não foi possível criar a barbearia", shopInsert.error)
              : "Não foi possível criar a barbearia: o banco não retornou o registro criado.";
            return json({ error: message }, 500);
          }
          const barbershopId = String((shopInsert.data as { id: string }).id);

          const barberInsert = await admin
            .from("barbers")
            .insert({
              user_id: user.id,
              name: parsed.data.name,
              business_name: parsed.data.business_name,
              is_admin: true,
              barbershop_id: barbershopId,
            })
            .select("id")
            .single();
          if (barberInsert.error || !barberInsert.data) {
            console.error("[create-barbershop] falha ao criar admin, desfazendo barbearia", barberInsert.error);
            await admin.from("barbershops").delete().eq("id", barbershopId);
            const message = barberInsert.error
              ? databaseError("Não foi possível concluir o cadastro", barberInsert.error)
              : "Não foi possível concluir o cadastro: o banco não retornou o registro criado.";
            return json({ error: message }, 500);
          }

          return json({
            barbershop_id: barbershopId,
            barber_id: String((barberInsert.data as { id: string }).id),
          });
        } catch (error) {
          console.error("[create-barbershop] erro inesperado", error);
          return json({ error: "Não foi possível concluir o cadastro." }, 500);
        }
      },
    },
  },
});
