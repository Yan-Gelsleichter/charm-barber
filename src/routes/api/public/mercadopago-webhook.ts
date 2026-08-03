import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

import { mapPaymentStatus } from "./mercadopago-pix";

export const Route = createFileRoute("/api/public/mercadopago-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const raw = (await request.json().catch(() => ({}))) as {
            type?: string;
            topic?: string;
            action?: string;
            user_id?: number | string;
            data?: { id?: number | string };
          };

          const topic = raw.type ?? raw.topic ?? url.searchParams.get("topic") ?? "";
          if (topic && !topic.includes("payment")) {
            return new Response("ignored", { status: 200 });
          }

          const paymentId = String(
            raw.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "",
          ).trim();
          if (!paymentId) return new Response("no payment id", { status: 200 });

          const supabaseUrl =
            process.env["SUPABASE_URL"] ||
            process.env["SB_URL"] ||
            process.env["VITE_SUPABASE_URL"];
          const serviceKey =
            process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
            process.env["SB_SERVICE_ROLE_KEY"] ||
            process.env["SERVICE_ROLE_KEY"];
          if (!supabaseUrl || !serviceKey) {
            console.error("Webhook MP: credenciais do banco ausentes");
            return new Response("misconfigured", { status: 500 });
          }

          const admin = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          // Descobre a barbearia dona do pagamento (pelo collector do webhook
          // ou pelo agendamento já vinculado a esse payment_id).
          let accessToken: string | null = null;
          if (raw.user_id) {
            const { data: shop } = await admin
              .from("barbershops")
              .select("mp_access_token")
              .eq("mp_user_id", String(raw.user_id))
              .maybeSingle();
            accessToken = shop?.mp_access_token ?? null;
          }
          if (!accessToken) {
            const { data: appt } = await admin
              .from("appointments")
              .select("barbershop_id")
              .eq("mp_payment_id", paymentId)
              .maybeSingle();
            if (appt?.barbershop_id) {
              const { data: shop } = await admin
                .from("barbershops")
                .select("mp_access_token")
                .eq("id", appt.barbershop_id)
                .maybeSingle();
              accessToken = shop?.mp_access_token ?? null;
            }
          }
          if (!accessToken) {
            console.error("Webhook MP: barbearia não identificada para o pagamento", paymentId);
            return new Response("unknown shop", { status: 200 });
          }

          const paymentResponse = await fetch(
            `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          const payment = (await paymentResponse.json().catch(() => ({}))) as {
            id?: number | string;
            status?: string;
            external_reference?: string;
            metadata?: { appointment_id?: string };
          };
          if (!paymentResponse.ok) {
            console.error("Webhook MP: falha ao consultar pagamento", paymentResponse.status);
            return new Response("payment fetch failed", { status: 200 });
          }

          const appointmentId = payment.external_reference || payment.metadata?.appointment_id;
          if (!appointmentId) return new Response("no appointment", { status: 200 });

          const paymentStatus = mapPaymentStatus(payment.status);
          const { error } = await admin
            .from("appointments")
            .update({
              payment_status: paymentStatus,
              payment_method: "pix",
              mp_payment_id: paymentId,
              paid_at: paymentStatus === "pago" ? new Date().toISOString() : null,
            })
            .eq("id", appointmentId);
          if (error) console.error("Webhook MP: falha ao atualizar agendamento", error);

          return new Response("ok", { status: 200 });
        } catch (error) {
          console.error("Webhook MP: erro inesperado", error);
          return new Response("error", { status: 200 });
        }
      },
    },
  },
});
