import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    appointment_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("status"),
    appointment_id: z.string().uuid(),
    payment_id: z.union([z.string().min(1).max(80), z.number().int().positive()]),
  }),
]);

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/mercadopago-pix")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "Faça login novamente para continuar." }, 401);
          }

          const parsed = requestSchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: "Dados do pagamento inválidos." }, 400);

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
            console.error("Mercado Pago PIX: credenciais do banco ausentes no servidor");
            return json({ error: "O pagamento está temporariamente indisponível." }, 503);
          }

          const asUser = createClient(supabaseUrl, publishableKey, {
            global: { headers: { Authorization: authorization } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: userData, error: userError } = await asUser.auth.getUser();
          if (userError || !userData.user) {
            return json({ error: "Sua sessão expirou. Faça login novamente." }, 401);
          }

          const admin = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: appointment, error: appointmentError } = await admin
            .from("appointments")
            .select("id, service_id, barbershop_id, customer_name, email")
            .eq("id", parsed.data.appointment_id)
            .maybeSingle();

          if (appointmentError) {
            console.error("Mercado Pago PIX: falha ao buscar agendamento", appointmentError);
            return json({ error: "Não foi possível localizar o agendamento." }, 500);
          }
          if (!appointment) return json({ error: "Agendamento não encontrado." }, 404);

          const userEmail = userData.user.email?.trim().toLowerCase();
          const appointmentEmail = String(appointment.email ?? "").trim().toLowerCase();
          if (!userEmail || !appointmentEmail || userEmail !== appointmentEmail) {
            return json({ error: "Você não tem acesso a este agendamento." }, 403);
          }
          if (!appointment.barbershop_id) {
            return json({ error: "O agendamento não está vinculado a uma barbearia." }, 400);
          }

          const { data: shop, error: shopError } = await admin
            .from("barbershops")
            .select("mp_access_token")
            .eq("id", appointment.barbershop_id)
            .maybeSingle();
          if (shopError) {
            console.error("Mercado Pago PIX: falha ao buscar barbearia", shopError);
            return json({ error: "Não foi possível carregar a conta de pagamento." }, 500);
          }
          if (!shop?.mp_access_token) {
            return json({ error: "Esta barbearia ainda não conectou o Mercado Pago." }, 400);
          }

          if (parsed.data.action === "status") {
            const paymentResponse = await fetch(
              `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(parsed.data.payment_id))}`,
              { headers: { Authorization: `Bearer ${shop.mp_access_token}` } },
            );
            const payment = (await paymentResponse.json().catch(() => ({}))) as {
              status?: string;
              status_detail?: string;
              message?: string;
            };
            if (!paymentResponse.ok) {
              console.error("Mercado Pago PIX: consulta recusada", paymentResponse.status, payment);
              return json({ error: payment.message ?? "Falha ao consultar o pagamento." }, 400);
            }
            return json({ status: payment.status, status_detail: payment.status_detail });
          }

          const { data: service, error: serviceError } = await admin
            .from("services")
            .select("name, price")
            .eq("id", appointment.service_id)
            .maybeSingle();
          if (serviceError || !service) {
            return json({ error: "Serviço do agendamento não encontrado." }, 404);
          }

          const amount = Number(service.price ?? 0);
          if (!(amount > 0)) return json({ error: "O serviço não possui um preço válido." }, 400);

          const paymentResponse = await fetch("https://api.mercadopago.com/v1/payments", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${shop.mp_access_token}`,
              "content-type": "application/json",
              "X-Idempotency-Key": `appointment-${appointment.id}`,
            },
            body: JSON.stringify({
              transaction_amount: Number(amount.toFixed(2)),
              description: `${service.name ?? "Serviço"} — agendamento`,
              payment_method_id: "pix",
              external_reference: appointment.id,
              payer: {
                email: userEmail,
                first_name: String(appointment.customer_name ?? "Cliente").split(" ")[0],
              },
            }),
          });
          const payment = (await paymentResponse.json().catch(() => ({}))) as {
            id?: number | string;
            status?: string;
            message?: string;
            point_of_interaction?: {
              transaction_data?: {
                qr_code?: string;
                qr_code_base64?: string;
                ticket_url?: string;
              };
            };
          };
          if (!paymentResponse.ok || !payment.id) {
            console.error("Mercado Pago PIX: criação recusada", paymentResponse.status, payment);
            return json({ error: payment.message ?? "Falha ao criar o pagamento PIX." }, 400);
          }

          const transaction = payment.point_of_interaction?.transaction_data;
          return json({
            payment_id: payment.id,
            status: payment.status ?? "pending",
            amount,
            qr_code: transaction?.qr_code ?? null,
            qr_code_base64: transaction?.qr_code_base64 ?? null,
            ticket_url: transaction?.ticket_url ?? null,
          });
        } catch (error) {
          console.error("Mercado Pago PIX: erro inesperado", error);
          return json({ error: "Não foi possível processar o PIX agora." }, 500);
        }
      },
    },
  },
});