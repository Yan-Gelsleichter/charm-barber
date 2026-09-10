import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Apaga um atendimento avulso lançado por engano. Só atua em linhas com
 * is_walk_in=true — nunca em agendamentos de verdade vindos do app.
 */

const requestSchema = z.object({ appointment_id: z.string().uuid() });

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/caixa-walkin-delete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "É preciso estar logado." }, 401);
          }
          const bearer = authorization.slice("Bearer ".length).trim();
          const { data: userData, error: authError } = await admin.auth.getUser(bearer);
          const user = userData.user;
          if (authError || !user) return json({ error: "Sessão inválida. Entre novamente." }, 401);

          const { data: adminBarber } = await admin
            .from("barbers")
            .select("barbershop_id")
            .eq("user_id", user.id)
            .eq("is_admin", true)
            .maybeSingle();
          const barbershopId = (adminBarber as { barbershop_id?: string } | null)?.barbershop_id;
          if (!barbershopId) {
            return json({ error: "Só o administrador da barbearia pode fazer isso." }, 403);
          }

          const found = await admin
            .from("appointments")
            .select("id, barbershop_id, is_walk_in")
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();
          const row = found.data as
            | { id: string; barbershop_id?: string | null; is_walk_in?: boolean | null }
            | null;
          if (found.error || !row) return json({ error: "Atendimento não encontrado." }, 404);
          if (row.barbershop_id !== barbershopId) {
            return json({ error: "Esse atendimento não é dessa barbearia." }, 403);
          }
          if (!row.is_walk_in) {
            return json({ error: "Só é possível excluir atendimentos avulsos." }, 400);
          }

          const deleted = await admin
            .from("appointments")
            .delete()
            .eq("id", parsed.data.appointment_id)
            .eq("is_walk_in", true);
          if (deleted.error) {
            console.error("[caixa-walkin-delete] falha ao excluir", deleted.error);
            return json({ error: "Não foi possível excluir o atendimento." }, 500);
          }

          return json({ ok: true });
        } catch (error) {
          console.error("[caixa-walkin-delete] erro inesperado", error);
          return json({ error: "Erro inesperado." }, 500);
        }
      },
    },
  },
});
