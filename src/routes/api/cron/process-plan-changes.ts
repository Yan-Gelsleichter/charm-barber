import { createFileRoute } from "@tanstack/react-router";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { createPlatformPreapproval, cancelPlatformPreapproval } from "@/lib/platform-subscription.server";

/**
 * Chamada periodicamente por um scheduler externo (com
 * "Authorization: Bearer <CRON_SECRET>", mesmo padrão de
 * api/cron/appointment-reminders.ts). Efetiva, na data certa
 * (current_period_ends_at), as duas transições de plano que o admin pode
 * agendar sem cobrança imediata pelo painel:
 *   - upgrade mensal → anual (pending_plan_change='yearly')
 *   - cancelamento (cancel_at_period_end=true) — a preapproval já foi
 *     cancelada de verdade no Mercado Pago no momento do clique; aqui só
 *     rebaixa o acesso local pra "canceled".
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (table: string) => any };

type UpgradeRow = {
  id: string;
  subscription_id: string | null;
  mp_payer_email: string | null;
};

async function processUpgrades(admin: Admin, nowIso: string, requestUrl: string) {
  const { data, error } = await admin
    .from("barbershops")
    .select("id, subscription_id, mp_payer_email")
    .eq("pending_plan_change", "yearly")
    .eq("subscription_status", "active")
    .lte("current_period_ends_at", nowIso);
  if (error) {
    console.error("process-plan-changes: falha ao buscar upgrades pendentes", error);
    return { processed: 0, upgraded: 0, failed: 0 };
  }

  const rows = (data ?? []) as UpgradeRow[];
  let upgraded = 0;
  let failed = 0;

  for (const row of rows) {
    const payerEmail = (row.mp_payer_email ?? "").trim();
    if (!payerEmail) {
      console.error("process-plan-changes: barbearia sem mp_payer_email, pulando upgrade", { id: row.id });
      failed += 1;
      continue;
    }

    const created = await createPlatformPreapproval({
      barbershopId: row.id,
      plan: "yearly",
      payerEmail,
      requestUrl,
    });
    if (!created.ok) {
      console.error("process-plan-changes: falha ao criar preapproval anual", {
        id: row.id,
        error: created.error,
      });
      failed += 1;
      continue;
    }

    const { data: updatedRows, error: updateError } = await admin
      .from("barbershops")
      .update({
        subscription_id: created.preapprovalId,
        subscription_plan: "yearly",
        pending_plan_change: null,
      })
      .eq("id", row.id)
      .eq("pending_plan_change", "yearly")
      .select("id");
    const committed = Array.isArray(updatedRows) && updatedRows.length > 0;

    if (updateError || !committed) {
      if (updateError) {
        console.error("process-plan-changes: falha ao gravar troca de plano", updateError);
      } else {
        console.warn("process-plan-changes: outra execução já processou, desfazendo preapproval nova", {
          id: row.id,
        });
      }
      await cancelPlatformPreapproval(created.preapprovalId);
      failed += 1;
      continue;
    }

    if (row.subscription_id) {
      await cancelPlatformPreapproval(row.subscription_id);
    }
    upgraded += 1;
  }

  return { processed: rows.length, upgraded, failed };
}

async function processCancellations(admin: Admin, nowIso: string) {
  const { data, error } = await admin
    .from("barbershops")
    .select("id")
    .eq("cancel_at_period_end", true)
    .eq("subscription_status", "active")
    .lte("current_period_ends_at", nowIso);
  if (error) {
    console.error("process-plan-changes: falha ao buscar cancelamentos pendentes", error);
    return { processed: 0, canceled: 0 };
  }

  const rows = (data ?? []) as { id: string }[];
  let canceled = 0;

  for (const row of rows) {
    const { data: updatedRows, error: updateError } = await admin
      .from("barbershops")
      .update({ subscription_status: "canceled", cancel_at_period_end: false })
      .eq("id", row.id)
      .eq("cancel_at_period_end", true)
      .select("id");
    if (updateError) {
      console.error("process-plan-changes: falha ao efetivar cancelamento", { id: row.id, error: updateError });
      continue;
    }
    if (Array.isArray(updatedRows) && updatedRows.length > 0) canceled += 1;
  }

  return { processed: rows.length, canceled };
}

export const Route = createFileRoute("/api/cron/process-plan-changes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cronSecret = process.env["CRON_SECRET"];
        if (cronSecret) {
          const authorization = request.headers.get("authorization") ?? "";
          if (authorization !== `Bearer ${cronSecret}`) {
            return new Response("unauthorized", { status: 401 });
          }
        }

        const admin = createSupabaseAdmin();
        if (!admin) return new Response("misconfigured", { status: 500 });

        const nowIso = new Date().toISOString();
        const [upgrades, cancellations] = await Promise.all([
          processUpgrades(admin, nowIso, request.url),
          processCancellations(admin, nowIso),
        ]);

        return Response.json({
          upgrades_processed: upgrades.processed,
          upgraded: upgrades.upgraded,
          upgrade_failed: upgrades.failed,
          cancellations_processed: cancellations.processed,
          canceled: cancellations.canceled,
        });
      },
    },
  },
});
