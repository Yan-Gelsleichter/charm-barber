import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Criação pública e autoritativa de agendamento com service role.
 * O INSERT não depende de sessão do cliente nem das políticas RLS.
 */

const requestSchema = z.object({
  barber_id: z.string().uuid(),
  service_id: z.string().uuid(),
  customer_name: z.string().min(2),
  customer_phone: z.string().regex(/^\d{8,15}$/),
  email: z.string().email().nullable().optional(),
  appointment_time: z.string().min(8),
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
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        try {
          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) {
            const reason = parsed.error.issues[0]?.message ?? "campos obrigatórios ausentes";
            return json({ error: `Erro ao salvar agendamento: dados inválidos (${reason}).` }, 400);
          }

          const admin = createSupabaseAdmin();
          if (!admin) {
            return json({ error: "Erro ao salvar agendamento: serviço temporariamente indisponível." }, 503);
          }

          const d = parsed.data;
          const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
          let userId: string | null = null;
          if (bearer) {
            const { data: authData, error: authError } = await admin.auth.getUser(bearer);
            if (authError) {
              return json({ error: "Erro ao salvar agendamento: sessão do cliente inválida." }, 401);
            }
            userId = authData.user?.id ?? null;
          }

          // appointment_time precisa chegar como timestamptz ISO válido; se vier
          // em outro formato, o Postgres rejeita a chamada inteira.
          const parsedTime = new Date(d.appointment_time);
          if (Number.isNaN(parsedTime.getTime())) {
            return json(
              { error: "Erro ao salvar agendamento: horário inválido (formato de data)." },
              400,
            );
          }
          const appointmentTimeIso = parsedTime.toISOString();

          const [barberResult, serviceResult] = await Promise.all([
            admin.from("barbers").select("id, barbershop_id").eq("id", d.barber_id).maybeSingle(),
            admin
              .from("services")
              .select("id, barber_id, barbershop_id, price")
              .eq("id", d.service_id)
              .maybeSingle(),
          ]);
          const barber = barberResult.data;
          const service = serviceResult.data;
          if (
            barberResult.error ||
            serviceResult.error ||
            !barber ||
            !service ||
            (service.barber_id && service.barber_id !== d.barber_id) ||
            (service.barbershop_id && service.barbershop_id !== barber.barbershop_id)
          ) {
            return json({ error: "Erro ao salvar agendamento: barbeiro ou serviço inválido." }, 400);
          }

          // Cobertura por assinatura: não depende de qual barbeiro atende, só
          // da identidade do cliente e do serviço escolhido nesta barbearia.
          let subscriptionCoverage: { subscriptionId: string } | null = null;
          if (barber.barbershop_id) {
            try {
              const { findActiveSubscriptionCoverage } = await import("@/lib/subscription.server");
              subscriptionCoverage = await findActiveSubscriptionCoverage(admin, {
                barbershopId: barber.barbershop_id,
                serviceId: d.service_id,
                barberId: d.barber_id,
                userId,
                phone: d.customer_phone,
                email: d.email?.trim().toLowerCase() || null,
              });
            } catch (coverageError) {
              console.error("[appointment-create] falha ao checar cobertura de assinatura", coverageError);
            }
          }

          // O agendamento é a escrita principal. A resposta positiva depende
          // somente desta inserção retornar a linha realmente persistida.
          const created = await admin
            .from("appointments")
            .insert({
              barber_id: d.barber_id,
              service_id: d.service_id,
              customer_name: d.customer_name.trim(),
              customer_phone: d.customer_phone,
              email: d.email?.trim().toLowerCase() || null,
              appointment_time: appointmentTimeIso,
              status: "confirmado",
              payment_status: subscriptionCoverage ? "coberto_por_assinatura" : "pendente",
              covered_by_subscription_id: subscriptionCoverage?.subscriptionId ?? null,
              barbershop_id: barber.barbershop_id,
              // Preço travado no momento do agendamento — relatórios (Produção,
              // histórico) não devem mudar retroativamente se o preço do
              // serviço for alterado depois.
              service_price_snapshot: Number(service.price ?? 0),
            })
            .select(
              "id, barber_id, service_id, customer_name, customer_phone, appointment_time, payment_status, covered_by_subscription_id",
            )
            .single();

          if (created.error || !created.data) {
            console.error("[appointment-create] insert de appointments falhou", {
              barberId: d.barber_id,
              serviceId: d.service_id,
              appointmentTime: appointmentTimeIso,
              message: created.error?.message,
              details: created.error?.details,
              hint: created.error?.hint,
              code: created.error?.code,
            });
            return json(
              {
                error: created.error
                  ? databaseError(created.error)
                  : "Erro ao salvar agendamento: o banco não retornou o registro criado.",
              },
              500,
            );
          }

          const savedAppointment = created.data;
          const persistedResult = await admin
            .from("appointments")
            .select(
              "id, barber_id, service_id, customer_name, customer_phone, appointment_time, payment_status, covered_by_subscription_id",
            )
            .eq("id", savedAppointment.id)
            .maybeSingle();
          if (persistedResult.error || !persistedResult.data) {
            console.error("[appointment-create] releitura de appointments falhou", {
              appointmentId: savedAppointment.id,
              message: persistedResult.error?.message,
              details: persistedResult.error?.details,
              hint: persistedResult.error?.hint,
              code: persistedResult.error?.code,
            });
            return json(
              { error: "Erro ao salvar agendamento: o banco não confirmou o registro inserido." },
              500,
            );
          }

          const confirmedAppointment = persistedResult.data;
          const savedTime = new Date(confirmedAppointment.appointment_time).getTime();
          if (
            confirmedAppointment.customer_phone !== d.customer_phone ||
            confirmedAppointment.customer_name.trim() !== d.customer_name.trim() ||
            confirmedAppointment.barber_id !== d.barber_id ||
            confirmedAppointment.service_id !== d.service_id ||
            savedTime !== parsedTime.getTime()
          ) {
            console.error("[appointment-create] appointment confirmado diverge da solicitação", {
              appointmentId: savedAppointment.id,
              expectedTime: appointmentTimeIso,
              savedTime: savedAppointment.appointment_time,
              phoneMatches: savedAppointment.customer_phone === d.customer_phone,
              nameMatches: savedAppointment.customer_name.trim() === d.customer_name.trim(),
            });
            return json(
              { error: "Erro ao salvar agendamento: o registro gravado não foi confirmado." },
              500,
            );
          }

          // A ficha do cliente é sincronizada depois e de forma independente.
          // Uma falha aqui é registrada para diagnóstico, mas nunca desfaz nem
          // bloqueia um horário que já foi confirmado em appointments.
          const email = d.email?.trim().toLowerCase() || null;
          const name = d.customer_name.trim();

          // A busca precisa cobrir cadastros feitos por outros caminhos
          // (telefone com máscara antiga, conta logada ou e-mail), senão o
          // insert bate em índice único e o cliente nunca é gravado.
          const findClient = async (
            column: "whatsapp" | "user_id" | "email",
            value: string,
          ) => {
            const r = await admin
              .from("clients")
              .select("id")
              .eq("barber_id", d.barber_id)
              .eq(column, value)
              .limit(1)
              .maybeSingle();
            return r.data?.id ? String(r.data.id) : null;
          };

          let clientId: string | null = null;
          try {
            clientId =
              (await findClient("whatsapp", d.customer_phone)) ||
              (userId ? await findClient("user_id", userId) : null) ||
              (email ? await findClient("email", email) : null);
          } catch (lookupError) {
            console.warn("[appointment-create] busca de cliente falhou", lookupError);
          }

          const baseValues: Record<string, unknown> = {
            barber_id: d.barber_id,
            name,
            whatsapp: d.customer_phone,
            email,
            barbershop_id: barber.barbershop_id,
          };
          if (userId) baseValues.user_id = userId;

          let clientError: string | null = null;
          if (clientId) {
            const upd = await admin
              .from("clients")
              .update(baseValues)
              .eq("id", clientId)
              .select("id")
              .maybeSingle();
            if (upd.error) clientError = upd.error.message;
          } else {
            let ins = await admin.from("clients").insert(baseValues).select("id").maybeSingle();
            if (ins.error) {
              // Retry mínimo: só as colunas essenciais, para o cadastro nunca
              // se perder por causa de coluna extra ou constraint auxiliar.
              const minimal = {
                barber_id: d.barber_id,
                name,
                whatsapp: d.customer_phone,
                barbershop_id: barber.barbershop_id,
              };
              const retry = await admin.from("clients").insert(minimal).select("id").maybeSingle();
              if (retry.error) {
                clientError = `${ins.error.message} | retry: ${retry.error.message}`;
              } else {
                ins = retry;
              }
            }
            clientId = ins.data?.id ? String(ins.data.id) : clientId;
          }

          if (clientError) {
            console.error("[appointment-create] agendamento salvo; cliente NÃO gravado", {
              appointmentId: savedAppointment.id,
              clientError,
            });
          }

          // Confirmação final: só declaramos o cliente sincronizado depois de
          // relê-lo na tabela clients.
          let confirmedClientId: string | null = null;
          if (clientId) {
            const check = await admin
              .from("clients")
              .select("id")
              .eq("id", clientId)
              .maybeSingle();
            confirmedClientId = check.data?.id ? String(check.data.id) : null;
          }

          return json({
            id: String(savedAppointment.id),
            client_id: confirmedClientId,
            client_synced: Boolean(confirmedClientId),
            client_error: clientError,
            persisted: true,
            appointment: confirmedAppointment,
            covered_by_subscription: Boolean(subscriptionCoverage),
          });


        } catch (error) {
          console.error("[appointment-create] erro inesperado", error);
          const message = error instanceof Error ? error.message : String(error);
          return json({ error: `Erro ao salvar agendamento: ${message}` }, 500);
        }
      },
    },
  },
});
