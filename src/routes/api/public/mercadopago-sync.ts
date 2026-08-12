/**
 * Reconciliação de pagamentos pendentes.
 *
 * Se o cliente paga o PIX pelo app do banco e nunca mais volta à tela do
 * agendamento (e o webhook falhou ou não chegou), o agendamento continuaria
 * como "pendente". Este endpoint é chamado pelo painel do barbeiro e consulta
 * no Mercado Pago o status real de cada pagamento pendente recente,
 * atualizando o agendamento para "pago"/"confirmado" automaticamente.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

import { mpPlatformCredentials } from "@/lib/mp-platform.server";
import { mapPaymentStatus } from "./mercadopago-pix";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (table: string) => any };

const LOOKBACK_DAYS = 30;
const MAX_APPOINTMENTS = 40;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Token da conta que recebeu o pagamento: barbeiro (split) → barbearia → plataforma. */
async function resolveToken(
  admin: Admin,
  cache: Map<string, string | null>,
  barberId: string | null,
  barbershopId: string | null,
): Promise<string | null> {
  const key = `${barberId ?? "-"}|${barbershopId ?? "-"}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  let token: string | null = null;
  if (barberId) {
    const { data } = await admin.from("barbers").select("mp_access_token").eq("id", barberId).maybeSingle();
    token = (data as { mp_access_token?: string | null } | null)?.mp_access_token ?? null;
  }
  if (!token && barbershopId) {
    const { data } = await admin
      .from("barbershops")
      .select("mp_access_token")
      .eq("id", barbershopId)
      .maybeSingle();
    token = (data as { mp_access_token?: string | null } | null)?.mp_access_token ?? null;
  }
  if (!token) token = mpPlatformCredentials()?.accessToken ?? null;
  cache.set(key, token);
  return token;
}

export const Route = createFileRoute("/api/public/mercadopago-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization") ?? "";
          if (!authorization.startsWith("Bearer ")) {
            return json({ error: "Faça login novamente." }, 401);
          }

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

          const admin: Admin = createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          // Só barbeiros/admins podem reconciliar, e apenas da própria barbearia.
          const { data: me } = await admin
            .from("barbers")
            .select("id, is_admin, barbershop_id")
            .eq("user_id", userData.user.id)
            .order("is_admin", { ascending: false })
            .limit(1)
            .maybeSingle();
          const barber = me as
            | { id: string; is_admin?: boolean | null; barbershop_id?: string | null }
            | null;
          if (!barber) return json({ error: "Acesso restrito." }, 403);

          const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
          let query = admin
            .from("appointments")
            .select("id, barber_id, barbershop_id, mp_payment_id, payment_status")
            .not("mp_payment_id", "is", null)
            .in("payment_status", ["pendente", "em_analise", "processando"])
            .gte("appointment_time", since)
            .limit(MAX_APPOINTMENTS);
          query = barber.is_admin
            ? barber.barbershop_id
              ? query.eq("barbershop_id", barber.barbershop_id)
              : query
            : query.eq("barber_id", barber.id);

          const { data: rows, error: rowsError } = await query;
          if (rowsError) {
            console.error("Sync MP: falha ao listar agendamentos pendentes", rowsError);
            return json({ error: "Não foi possível verificar os pagamentos." }, 500);
          }

          const pending = (rows ?? []) as Array<{
            id: string;
            barber_id: string | null;
            barbershop_id: string | null;
            mp_payment_id: string | null;
          }>;

          const cache = new Map<string, string | null>();
          let updated = 0;

          for (const row of pending) {
            if (!row.mp_payment_id) continue;
            const token = await resolveToken(admin, cache, row.barber_id, row.barbershop_id);
            if (!token) continue;

            const res = await fetch(
              `https://api.mercadopago.com/v1/payments/${encodeURIComponent(row.mp_payment_id)}`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!res.ok) continue;
            const payment = (await res.json().catch(() => ({}))) as { status?: string };
            const paymentStatus = mapPaymentStatus(payment.status);
            if (paymentStatus === "pendente") continue;

            const { error: updateError } = await admin
              .from("appointments")
              .update({
                payment_status: paymentStatus,
                paid_at: paymentStatus === "pago" ? new Date().toISOString() : null,
              })
              .eq("id", row.id);
            if (updateError) {
              console.error("Sync MP: falha ao atualizar agendamento", updateError);
              continue;
            }
            if (paymentStatus === "pago") {
              await admin.from("appointments").update({ status: "confirmado" }).eq("id", row.id);
            }
            updated += 1;
          }

          return json({ checked: pending.length, updated });
        } catch (error) {
          console.error("Sync MP: erro inesperado", error);
          return json({ error: "Não foi possível verificar os pagamentos." }, 500);
        }
      },
    },
  },
});
