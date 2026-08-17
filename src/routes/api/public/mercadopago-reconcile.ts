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
import { mapPaymentStatus } from "./mercadopago-pix";

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
          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "Faça login novamente." }, 401);
          }

          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados inválidos." }, 400);

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

          const asUser = createClient(supabaseUrl, publishableKey, {
            global: { headers: { Authorization: authorization } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: userData, error: userError } = await asUser.auth.getUser();
          if (userError || !userData.user) return json({ error: "Sessão expirada." }, 401);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const admin: any = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data, error } = await admin
            .from("appointments")
            .select("id, email, barber_id, barbershop_id, mp_payment_id, payment_status")
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

          const paymentId = parsed.data.payment_id ?? appointment.mp_payment_id;
          if (paymentId) {
            const res = await fetch(
              `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
              { headers: auth },
            );
            if (res.ok) payment = await res.json().catch(() => null);
          }

          // Sem payment_id: procura pelo external_reference do agendamento.
          if (!payment) {
            const res = await fetch(
              `https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(appointment.id)}`,
              { headers: auth },
            );
            if (res.ok) {
              const body = (await res.json().catch(() => ({}))) as {
                results?: Array<{ id?: number; status?: string; external_reference?: string }>;
              };
              payment =
                (body.results ?? []).find((p) =>
                  String(p.external_reference ?? "").startsWith(appointment.id),
                ) ?? null;
            }
          }

          if (!payment?.status) {
            return json({ payment_status: appointment.payment_status, updated: false });
          }

          const paymentStatus = mapPaymentStatus(payment.status);
          const patch: Record<string, unknown> = {
            payment_status: paymentStatus,
            payment_method: "online",
            paid_at: paymentStatus === "pago" ? new Date().toISOString() : null,
          };
          if (payment.id) patch["mp_payment_id"] = String(payment.id);
          await admin.from("appointments").update(patch).eq("id", appointment.id);
          if (paymentStatus === "pago") {
            await admin.from("appointments").update({ status: "confirmado" }).eq("id", appointment.id);
          }

          return json({ payment_status: paymentStatus, updated: true });
        } catch (e) {
          console.error("Reconcile MP: erro inesperado", e);
          return json({ error: "Não foi possível verificar o pagamento." }, 500);
        }
      },
    },
  },
});
