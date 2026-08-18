import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Criação pública e autoritativa de agendamento com service role.
 * O INSERT não depende de sessão do cliente nem das políticas RLS.
 */

const requestSchema = z.object({
  barber_id: z.string().uuid(),
  service_id: z.string().uuid(),
  customer_name: z.string().min(2),
  customer_phone: z.string().min(8),
  email: z.string().email().nullable().optional(),
  appointment_time: z.string().min(8),
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
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) {
            const reason = parsed.error.issues[0]?.message ?? "campos obrigatórios ausentes";
            return json({ error: `Erro ao salvar agendamento: dados inválidos (${reason}).` }, 400);
          }

          const supabaseUrl =
            process.env["SUPABASE_URL"] ||
            process.env["SB_URL"] ||
            process.env["VITE_SUPABASE_URL"] ||
            (import.meta.env.VITE_SUPABASE_URL as string | undefined);
          const serviceKey =
            process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
            process.env["SB_SERVICE_ROLE_KEY"] ||
            process.env["SERVICE_ROLE_KEY"];

          if (!supabaseUrl || !serviceKey) {
            return json({ error: "Erro ao salvar agendamento: serviço temporariamente indisponível." }, 503);
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
          // Não confia no vínculo enviado pelo navegador: serviço, barbeiro e
          // barbearia são confirmados diretamente no banco antes do INSERT.
          const [barberResult, serviceResult] = await Promise.all([
            admin.from("barbers").select("id, barbershop_id").eq("id", d.barber_id).maybeSingle(),
            admin
              .from("services")
              .select("id, barber_id, barbershop_id")
              .eq("id", d.service_id)
              .maybeSingle(),
          ]);
          if (barberResult.error) {
            return json({ error: databaseError(barberResult.error) }, 500);
          }
          if (serviceResult.error) {
            return json({ error: databaseError(serviceResult.error) }, 500);
          }
          const barber = barberResult.data as { id: string; barbershop_id: string | null } | null;
          const service = serviceResult.data as {
            id: string;
            barber_id: string | null;
            barbershop_id: string | null;
          } | null;
         if (!barber || !service) {
  return json(
    { error: "Erro ao salvar agendamento: serviço ou barbeiro inválido." },
    400,
  );
}
// Permite o serviço caso o barber_id bata ou caso o serviço seja global (null)
if (service.barber_id && service.barber_id !== barber.id) {
  return json(
    { error: "Erro ao salvar agendamento: este serviço não pertence ao barbeiro selecionado." },
    400,
  );
}
          const barbershopId = barber.barbershop_id ?? service.barbershop_id;
          if (!barbershopId) {
            return json(
              { error: "Erro ao salvar agendamento: barbeiro sem barbearia vinculada." },
              400,
            );
          }
          const full = {
            barber_id: d.barber_id,
            service_id: d.service_id,
            customer_name: d.customer_name,
            customer_phone: d.customer_phone,
            email: d.email ?? null,
            appointment_time: d.appointment_time,
            status: "confirmado",
            payment_status: "pendente",
            barbershop_id: barbershopId,
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
