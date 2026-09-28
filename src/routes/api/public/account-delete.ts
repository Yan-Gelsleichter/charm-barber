import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { previewAccountDeletion, performAccountDeletion } from "@/lib/account-deletion.server";

/**
 * Exclusão de conta (Play Store + LGPD) — endpoint único, chamado tanto pelo
 * botão no Perfil/`meus-agendamentos` quanto pela página pública
 * `/excluir-dados`. Toda a regra de negócio vive em
 * `src/lib/account-deletion.server.ts`.
 *
 * `dry_run: true` só devolve o que aconteceria (bloqueios ou resumo), sem
 * mudar nada — usado pra montar a tela de confirmação. Sem `dry_run`, exige
 * uma sessão recente (reautenticação de verdade, feita pelo cliente logo
 * antes de chamar isso — ver ExcluirContaSection.tsx) e executa a exclusão.
 */

const MAX_TOKEN_AGE_MS = 10 * 60 * 1000;

const requestSchema = z.object({
  dry_run: z.boolean().optional(),
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...CORS_HEADERS } });
}

/** Idade do token em ms, a partir do `iat` do próprio JWT — sem verificar a assinatura de novo (já feito por `auth.getUser`). */
function tokenAgeMs(bearer: string): number | null {
  try {
    const payload = bearer.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const json = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as { iat?: number };
    if (typeof json.iat !== "number") return null;
    return Date.now() - json.iat * 1000;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/account-delete")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

          const admin = createSupabaseAdmin();
          if (!admin) return json({ error: "Serviço temporariamente indisponível." }, 503);

          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) return json({ error: "É preciso estar logado." }, 401);
          const bearer = authorization.slice("Bearer ".length).trim();
          const { data: userData, error: authError } = await admin.auth.getUser(bearer);
          const user = userData.user;
          if (authError || !user) return json({ error: "Sessão inválida. Entre novamente." }, 401);

          if (parsed.data.dry_run) {
            const preview = await previewAccountDeletion(admin, user.id);
            return json({ preview });
          }

          const age = tokenAgeMs(bearer);
          if (age === null || age > MAX_TOKEN_AGE_MS) {
            return json(
              { error: "Por segurança, confirme sua senha (ou o Google) de novo antes de excluir a conta." },
              401,
            );
          }

          const result = await performAccountDeletion(admin, user.id);
          if (!result.ok) {
            return json({ error: result.reasons.join(" "), reasons: result.reasons }, 409);
          }
          return json({ ok: true });
        } catch (error) {
          console.error("[account-delete] erro inesperado", error);
          return json({ error: "Não foi possível processar a exclusão." }, 500);
        }
      },
    },
  },
});
