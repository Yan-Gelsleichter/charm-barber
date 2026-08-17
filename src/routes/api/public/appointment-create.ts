import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Criação autoritativa de agendamento com service role.
 * O usuário precisa estar logado, mas o INSERT não depende das políticas RLS
 * do cliente.
 */

const requestSchema = z.object({
  barber_id: z.string().uuid(),
  service_id: z.string().uuid(),
  customer_name: z.string().min(2),
  customer_phone: z.string().min(8),
  email: z.string().email().nullable().optional(),
  appointment_time: z.string().min(8),
  barbershop_id: z.string().uuid().nullable().optional(),
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function databaseError(error: {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}) {
  const extra = [error.details, error.hint, error.code ? `código ${error.code}` : null]
    .filter(Boolean)
    .join(" · ");
  return `Erro ao salvar agendamento: ${error.message}${extra ? ` (${extra})` : ""}`;
}

export const Route = createFileRoute("/api/public/appointment-create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "Faça login novamente para continuar." }, 401);
          }

          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados do agendamento inválidos." }, 400);

          const supabaseUrl =
            process.env["SUPABASE_URL"] ||
            process.env["SB_URL"] ||
            process.env["VITE_SUPABASE_URL"] ||
            (import.meta.env.VITE_SUPABASE_URL as string | undefined);
          const publishableKey =
            process.env["SUPABASE_PUBLISHABLE_KEY"] ||
            process.env["SB_PUBLISHABLE_KEY"] ||
            process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
            (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);
          const serviceKey =
            process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
            process.env["SB_SERVICE_ROLE_KEY"] ||
            process.env["SERVICE_ROLE_KEY"];

          if (!supabaseUrl || !publishableKey || !serviceKey) {
            return json({ error: "Serviço temporariamente indisponível." }, 503);
          }

          const asUser = createClient(supabaseUrl, publishableKey, {
            global: { headers: { Authorization: authorization } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: userData, error: userError } = await asUser.auth.getUser();
          if (userError || !userData.user) {
            return json({ error: "Sua sessão expirou. Faça login novamente." }, 401);
          }

          // Chaves sb_secret_* são opacas, não JWT. Elas devem ir em `apikey`,
          // sem `Authorization: Bearer <chave>`, para o PostgREST reconhecer a
          // identidade de serviço e ignorar RLS corretamente.
          const admin = createClient(supabaseUrl, serviceKey, {
            auth: {
              storage: undefined,
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false,
            },
            global: {
              fetch: (input, init) => {
                const headers = new Headers(init?.headers);
                if (
                  serviceKey.startsWith("sb_") &&
                  headers.get("Authorization") === `Bearer ${serviceKey}`
                ) {
                  headers.delete("Authorization");
                }
                headers.set("apikey", serviceKey);
                return fetch(input, { ...init, headers });
              },
            },
          });

          const d = parsed.data;
          const full = {
            barber_id: d.barber_id,
            service_id: d.service_id,
            customer_name: d.customer_name,
            customer_phone: d.customer_phone,
            email: d.email ?? null,
            appointment_time: d.appointment_time,
            status: "confirmado",
            payment_status: "pendente",
            ...(d.barbershop_id ? { barbershop_id: d.barbershop_id } : {}),
          };

          const inserted = await admin.from("appointments").insert(full).select("id").single();
          if (inserted.error || !inserted.data) {
            console.error("[appointment-create] insert falhou", inserted.error);
            return json(
              {
                error: inserted.error
                  ? databaseError(inserted.error)
                  : "Erro ao salvar agendamento: o banco não retornou o registro criado.",
              },
              500,
            );
          }

          return json({ id: (inserted.data as { id: string }).id });
        } catch (error) {
          console.error("[appointment-create] erro inesperado", error);
          const message = error instanceof Error ? error.message : String(error);
          return json({ error: `Erro ao salvar agendamento: ${message}` }, 500);
        }
      },
    },
  },
});
