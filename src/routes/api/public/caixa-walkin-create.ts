import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";

/**
 * Cria um atendimento avulso (presencial, registrado direto pelo admin no
 * balcão, sem passar pelo app). Marcado is_walk_in=true — não conta como
 * horário ocupado pra ninguém (ver docs/fix-availability-rpc.sql e
 * src/lib/availability.ts). barbershop_id vem sempre do admin logado, nunca
 * do corpo da requisição.
 *
 * Status inicial: o admin escolhe "Pago" (padrão, mesma atendimento pago na
 * hora) ou "Pendente" (barbearias que atendem primeiro e fecham a conta
 * depois — aparece com os mesmos botões Dinheiro/Pix/Cartão da lista). Um
 * serviço extra vinculado a outro agendamento (parent_appointment_id) nasce
 * sempre pendente, independente do que for enviado — é resolvido separado do
 * que já foi pago no agendamento original.
 */

const requestSchema = z.object({
  barber_id: z.string().uuid(),
  service_ids: z.array(z.string().uuid()).min(1),
  customer_name: z.string().trim().min(1).max(120),
  price: z.number().nonnegative(),
  appointment_time: z.string().min(1),
  payment_status: z.enum(["pago", "pendente"]).optional(),
  // Só usado pelo fluxo "Adicionar serviço" no Caixa: vincula esse avulso a
  // um agendamento do app já existente, pra aparecer agrupado com ele.
  parent_appointment_id: z.string().uuid().optional(),
  // Telefone do cliente (opcional) — ajuda a identificar quem é assinante.
  customer_phone: z.string().regex(/^\d{8,15}$/).optional(),
  // Cliente assinante: o atendimento (service_ids) é coberto pelo plano —
  // entra na agenda sem cobrança. Sempre revalidado aqui no servidor.
  subscription_id: z.string().uuid().optional(),
  // Serviços FORA do plano, cobrados à parte (só junto com subscription_id).
  extra: z
    .object({
      service_ids: z.array(z.string().uuid()).min(1),
      price: z.number().nonnegative(),
    })
    .optional(),
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/caixa-walkin-create")({
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

          const { data: targetBarber } = await admin
            .from("barbers")
            .select("id, barbershop_id")
            .eq("id", parsed.data.barber_id)
            .maybeSingle();
          if (
            !targetBarber ||
            (targetBarber as { barbershop_id?: string | null }).barbershop_id !== barbershopId
          ) {
            return json({ error: "Barbeiro não pertence a essa barbearia." }, 400);
          }

          const { data: targetServicesData } = await admin
            .from("services")
            .select("id, barber_id, duration_minutes, price")
            .in("id", parsed.data.service_ids);
          const targetServices = (targetServicesData ?? []) as {
            id: string;
            barber_id: string | null;
            duration_minutes: number | null;
            price: number | null;
          }[];
          const allServicesValid =
            targetServices.length === parsed.data.service_ids.length &&
            targetServices.every((s) => s.barber_id === parsed.data.barber_id);
          if (!allServicesValid) {
            return json({ error: "Serviço não pertence a esse barbeiro." }, 400);
          }

          if (parsed.data.parent_appointment_id) {
            const { data: parent } = await admin
              .from("appointments")
              .select("id, barbershop_id")
              .eq("id", parsed.data.parent_appointment_id)
              .maybeSingle();
            if (
              !parent ||
              (parent as { barbershop_id?: string | null }).barbershop_id !== barbershopId
            ) {
              return json({ error: "Agendamento original não encontrado." }, 400);
            }
          }

          const appointmentTime = new Date(parsed.data.appointment_time);
          if (Number.isNaN(appointmentTime.getTime())) {
            return json({ error: "Data/hora inválida." }, 400);
          }

          const totalDuration = targetServices.reduce(
            (sum, s) => sum + Number(s.duration_minutes ?? 30),
            0,
          );

          const isExtra = !!parsed.data.parent_appointment_id;

          // Cliente assinante: atendimento coberto pelo plano (sem cobrança).
          const subscriptionId = parsed.data.subscription_id;
          if (parsed.data.extra && !subscriptionId) {
            return json({ error: "Serviço fora do plano só vale para cliente assinante." }, 400);
          }
          if (subscriptionId && isExtra) {
            return json({ error: "Assinatura não se aplica a serviço extra." }, 400);
          }
          if (subscriptionId) {
            const { subscriptionCoversServices } = await import("@/lib/subscription.server");
            const covers = await subscriptionCoversServices(admin, {
              barbershopId,
              subscriptionId,
              serviceIds: parsed.data.service_ids,
              barberId: parsed.data.barber_id,
            });
            if (!covers) {
              return json({ error: "O plano do cliente não cobre esses serviços com esse barbeiro." }, 400);
            }
          }

          // Serviços fora do plano: precisam ser do mesmo barbeiro.
          let extraServices: { id: string; duration_minutes: number | null }[] = [];
          if (parsed.data.extra) {
            const extraIds = parsed.data.extra.service_ids;
            if (extraIds.some((id) => parsed.data.service_ids.includes(id))) {
              return json({ error: "Serviço repetido no plano e fora dele." }, 400);
            }
            const { data: extraData } = await admin
              .from("services")
              .select("id, barber_id, duration_minutes")
              .in("id", extraIds);
            const rows = (extraData ?? []) as {
              id: string;
              barber_id: string | null;
              duration_minutes: number | null;
            }[];
            if (rows.length !== extraIds.length || rows.some((s) => s.barber_id !== parsed.data.barber_id)) {
              return json({ error: "Serviço fora do plano não pertence a esse barbeiro." }, 400);
            }
            extraServices = rows;
          }

          const paymentStatus = subscriptionId
            ? "coberto_por_assinatura"
            : isExtra
              ? "pendente"
              : (parsed.data.payment_status ?? "pago");
          const paid = paymentStatus === "pago";
          // Coberto pelo plano: o valor gravado é o de referência (preço dos
          // serviços), calculado aqui no servidor — não é dinheiro cobrado.
          const priceSnapshot = subscriptionId
            ? targetServices.reduce((sum, s) => sum + Number(s.price ?? 0), 0)
            : parsed.data.price;

          const inserted = await admin
            .from("appointments")
            .insert({
              barber_id: parsed.data.barber_id,
              service_id: parsed.data.service_ids[0],
              service_ids: parsed.data.service_ids,
              barbershop_id: barbershopId,
              customer_name: parsed.data.customer_name,
              customer_phone: parsed.data.customer_phone ?? "",
              appointment_time: appointmentTime.toISOString(),
              status: "confirmado",
              payment_status: paymentStatus,
              payment_method: paid ? "presencial" : null,
              paid_at: paid ? new Date().toISOString() : null,
              service_price_snapshot: priceSnapshot,
              duration_minutes_snapshot: totalDuration,
              is_walk_in: true,
              parent_appointment_id: parsed.data.parent_appointment_id ?? null,
              covered_by_subscription_id: subscriptionId ?? null,
            })
            .select("*")
            .maybeSingle();
          if (inserted.error || !inserted.data) {
            console.error("[caixa-walkin-create] falha ao inserir", inserted.error);
            return json({ error: "Não foi possível registrar o atendimento." }, 500);
          }

          // Serviços fora do plano: atendimento extra ligado ao principal,
          // no status escolhido (Pago/Pendente) pelo admin.
          if (parsed.data.extra) {
            const extraPaid = (parsed.data.payment_status ?? "pago") === "pago";
            const extraInsert = await admin
              .from("appointments")
              .insert({
                barber_id: parsed.data.barber_id,
                service_id: parsed.data.extra.service_ids[0],
                service_ids: parsed.data.extra.service_ids,
                barbershop_id: barbershopId,
                customer_name: parsed.data.customer_name,
                customer_phone: parsed.data.customer_phone ?? "",
                appointment_time: appointmentTime.toISOString(),
                status: "confirmado",
                payment_status: extraPaid ? "pago" : "pendente",
                payment_method: extraPaid ? "presencial" : null,
                paid_at: extraPaid ? new Date().toISOString() : null,
                service_price_snapshot: parsed.data.extra.price,
                duration_minutes_snapshot: extraServices.reduce(
                  (sum, s) => sum + Number(s.duration_minutes ?? 30),
                  0,
                ),
                is_walk_in: true,
                parent_appointment_id: (inserted.data as { id: string }).id,
              })
              .select("id")
              .maybeSingle();
            if (extraInsert.error || !extraInsert.data) {
              console.error("[caixa-walkin-create] falha ao inserir serviço fora do plano", extraInsert.error);
              return json({
                ok: true,
                appointment: inserted.data,
                extra_error: "O atendimento do plano foi registrado, mas o serviço fora do plano não.",
              });
            }
          }

          return json({ ok: true, appointment: inserted.data });
        } catch (error) {
          console.error("[caixa-walkin-create] erro inesperado", error);
          return json({ error: "Erro inesperado." }, 500);
        }
      },
    },
  },
});
