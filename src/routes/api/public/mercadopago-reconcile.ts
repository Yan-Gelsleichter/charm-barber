/**
 * Reconciliação imediata de UM agendamento.
 *
 * Chamado pela tela de confirmação assim que o cliente volta do Checkout Pro:
 * consulta o pagamento direto na API do Mercado Pago e grava o status real no
 * agendamento, sem depender do webhook chegar primeiro.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { mpPlatformCredentials } from "@/lib/mp-platform.server";
import { mapPaymentStatus } from "@/lib/mp-status.server";
import { withReconcileLock } from "@/lib/mp-reconcile-lock.server";

const requestSchema = z.object({
  appointment_id: z.string().uuid(),
  payment_id: z.string().trim().max(64).optional(),
  merchant_order_id: z.string().trim().max(64).optional(),
  preference_id: z.string().trim().max(128).optional(),
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/public/mercadopago-reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Sessão é opcional: clientes anônimos também precisam reconciliar.
          const authorization = request.headers.get("authorization") ?? "";
          const hasSession = authorization.startsWith("Bearer ");


          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

          // Idempotência: chamadas concorrentes (polling em várias abas) para o
          // mesmo agendamento compartilham uma única execução.
          const core = async (): Promise<Response> => {


          const supabaseUrl =
            process.env["SUPABASE_URL"] ||
            process.env["SB_URL"] ||
            process.env["VITE_SUPABASE_URL"];
          const publishableKey =
            process.env["SUPABASE_PUBLISHABLE_KEY"] ||
            process.env["SB_PUBLISHABLE_KEY"] ||
            process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
          const serviceKey =
            process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
            process.env["SB_SERVICE_ROLE_KEY"] ||
            process.env["SERVICE_ROLE_KEY"];
          if (!supabaseUrl || !publishableKey || !serviceKey) {
            return json({ error: "Serviço indisponível." }, 503);
          }

          let userEmail: string | null = null;
          if (hasSession) {
            const asUser = createClient(supabaseUrl, publishableKey, {
              global: { headers: { Authorization: authorization } },
              auth: { persistSession: false, autoRefreshToken: false },
            });
            const { data: userData } = await asUser.auth.getUser();
            userEmail = userData?.user?.email?.trim().toLowerCase() ?? null;
          }


          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const admin: any = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data, error } = await admin
            .from("appointments")
            .select("id, email, barber_id, barbershop_id, mp_payment_id, payment_status, payment_method, paid_at")
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();
          if (error) return json({ error: "Não foi possível verificar o pagamento." }, 500);
          const appointment = data as {
            id: string;
            email: string | null;
            barber_id: string | null;
            barbershop_id: string | null;
            mp_payment_id: string | null;
            payment_status: string | null;
            payment_method: string | null;
            paid_at: string | null;
          } | null;
          if (!appointment) return json({ error: "Agendamento não encontrado." }, 404);

          const userEmail = userData.user.email?.trim().toLowerCase();
          const apptEmail = String(appointment.email ?? "")
            .trim()
            .toLowerCase();
          if (!userEmail || !apptEmail || userEmail !== apptEmail) {
            return json({ error: "Acesso negado." }, 403);
          }

          if (appointment.payment_status === "pago") {
            // Já está pago: garante que paid_at nunca fique vazio.
            if (!appointment.paid_at) {
              await admin
                .from("appointments")
                .update({ paid_at: new Date().toISOString() })
                .eq("id", appointment.id);
              return json({ payment_status: "pago", updated: true });
            }
            return json({ payment_status: "pago", updated: false });
          }

          // Token da conta que recebeu: barbeiro (split) → barbearia → plataforma.
          let token: string | null = null;
          if (appointment.barber_id) {
            const { data: barber } = await admin
              .from("barbers")
              .select("mp_access_token")
              .eq("id", appointment.barber_id)
              .maybeSingle();
            token = (barber as { mp_access_token?: string | null } | null)?.mp_access_token ?? null;
          }
          if (!token && appointment.barbershop_id) {
            const { data: shop } = await admin
              .from("barbershops")
              .select("mp_access_token")
              .eq("id", appointment.barbershop_id)
              .maybeSingle();
            token = (shop as { mp_access_token?: string | null } | null)?.mp_access_token ?? null;
          }
          if (!token) token = mpPlatformCredentials()?.accessToken ?? null;
          if (!token) return json({ payment_status: appointment.payment_status, updated: false });

          const auth = { Authorization: `Bearer ${token}` };
          let payment: { id?: number | string; status?: string } | null = null;

          // mp_payment_id pode guardar "pref:<preference_id>" (salvo ao criar o Checkout Pro).
          const stored = String(appointment.mp_payment_id ?? "");
          const storedPreferenceId = stored.startsWith("pref:") ? stored.slice(5) : null;
          const preferenceId = parsed.data.preference_id ?? storedPreferenceId;
          const paymentId = parsed.data.payment_id ?? (storedPreferenceId ? null : stored || null);
          if (paymentId) {
            const res = await fetch(
              `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
              { headers: auth },
            );
            if (res.ok) payment = await res.json().catch(() => null);
          }

          // merchant_order (Checkout Pro devolve esse id no retorno)
          if (!payment?.status && parsed.data.merchant_order_id) {
            const res = await fetch(
              `https://api.mercadopago.com/merchant_orders/${encodeURIComponent(parsed.data.merchant_order_id)}`,
              { headers: auth },
            );
            if (res.ok) {
              const body = (await res.json().catch(() => ({}))) as {
                payments?: Array<{ id?: number; status?: string }>;
              };
              const list = body.payments ?? [];
              payment = list.find((p) => p.status === "approved") ?? list[0] ?? null;
            }
          }

          // Checkout Pro: a preferência não é pesquisável em /v1/payments/search.
          // Buscamos as merchant_orders da preferência e pegamos os pagamentos delas.
          if (!payment?.status && preferenceId) {
            const res = await fetch(
              `https://api.mercadopago.com/merchant_orders/search?preference_id=${encodeURIComponent(preferenceId)}`,
              { headers: auth },
            );
            if (res.ok) {
              const body = (await res.json().catch(() => ({}))) as {
                elements?: Array<{ payments?: Array<{ id?: number; status?: string }> }>;
                results?: Array<{ payments?: Array<{ id?: number; status?: string }> }>;
              };
              const orders = body.elements ?? body.results ?? [];
              const all = orders.flatMap((o) => o.payments ?? []);
              payment = all.find((p) => p.status === "approved") ?? all[0] ?? null;
            }
          }

          // Último recurso: procura pelo external_reference do agendamento.
          if (!payment?.status) {
            const res = await fetch(
              `https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(appointment.id)}`,
              { headers: auth },
            );
            if (res.ok) {
              const body = (await res.json().catch(() => ({}))) as {
                results?: Array<{ id?: number; status?: string; external_reference?: string }>;
              };
              const results = body.results ?? [];
              payment =
                results.find((p) => p.status === "approved") ??
                results.find((p) =>
                  String(p.external_reference ?? "").startsWith(appointment.id),
                ) ??
                results[0] ??
                null;
            }
          }

          // O pagamento vindo da merchant_order traz só um resumo: busca o detalhe.
          if (payment?.id && payment.status !== "approved") {
            const res = await fetch(
              `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(payment.id))}`,
              { headers: auth },
            );
            if (res.ok) payment = (await res.json().catch(() => payment)) ?? payment;
          }

          if (!payment?.status) {
            return json({ payment_status: appointment.payment_status, updated: false });
          }

          const paymentStatus = mapPaymentStatus(payment.status);
          const mpPaymentId = payment.id ? String(payment.id) : null;
          const paidAt =
            paymentStatus === "pago"
              ? (appointment.paid_at ?? new Date().toISOString())
              : paymentStatus === "estornado"
                ? appointment.paid_at
                : null;

          // Idempotência: se nada mudou, não escreve nada.
          const unchanged =
            appointment.payment_status === paymentStatus &&
            appointment.payment_method === "online" &&
            (appointment.paid_at ?? null) === (paidAt ?? null) &&
            (!mpPaymentId || appointment.mp_payment_id === mpPaymentId);
          if (unchanged) {
            return json({ payment_status: paymentStatus, updated: false });
          }

          const patch: Record<string, unknown> = {
            payment_status: paymentStatus,
            payment_method: "online",
            paid_at: paidAt,
          };
          if (mpPaymentId) patch["mp_payment_id"] = mpPaymentId;

          // Escrita condicional: só grava se o status ainda for o mesmo que lemos.
          // Se outra requisição já reconciliou, esta não sobrescreve nem duplica.
          let query = admin.from("appointments").update(patch).eq("id", appointment.id);
          query =
            appointment.payment_status === null
              ? query.is("payment_status", null)
              : query.eq("payment_status", appointment.payment_status);
          const { data: updatedRows } = await query.select("id");
          const didUpdate = Array.isArray(updatedRows) && updatedRows.length > 0;

          if (didUpdate && paymentStatus === "pago") {
            await admin
              .from("appointments")
              .update({ status: "confirmado" })
              .eq("id", appointment.id)
              .neq("status", "confirmado");
          }

          return json({ payment_status: paymentStatus, updated: didUpdate });
          };

          const result = await withReconcileLock(parsed.data.appointment_id, core);
          // Cada chamador recebe uma cópia: o corpo só pode ser lido uma vez.
          return result.clone();

        } catch (e) {
          console.error("Reconcile MP: erro inesperado", e);
          return json({ error: "Não foi possível verificar o pagamento." }, 500);
        }
      },
    },
  },
});
