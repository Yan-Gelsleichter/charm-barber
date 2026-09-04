import { createFileRoute } from "@tanstack/react-router";

import { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { createPlatformPreapproval, cancelPlatformPreapproval } from "@/lib/platform-subscription.server";

/**
 * Chamada periodicamente por um scheduler externo (com
 * "Authorization: Bearer <CRON_SECRET>", mesmo padrão de
 * api/cron/appointment-reminders.ts). Efetiva o upgrade mensal → anual das
 * barbearias com pending_plan_change='yearly' cujo período atual já virou —
 * sem cobrança imediata, sem perda de dias: a nova assinatura só nasce
 * quando a mensal atual termina.
 */

type BarbershopRow = {
  id: string;
  subscription_id: string | null;
  mp_payer_email: string | null;
};

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
        const { data, error } = await admin
          .from("barbershops")
          .select("id, subscription_id, mp_payer_email")
          .eq("pending_plan_change", "yearly")
          .eq("subscription_status", "active")
          .lte("current_period_ends_at", nowIso);
        if (error) {
          console.error("process-plan-changes: falha ao buscar barbearias", error);
          return new Response("query failed", { status: 500 });
        }

        const rows = (data ?? []) as BarbershopRow[];
        let upgraded = 0;
        let failed = 0;

        for (const row of rows) {
          const payerEmail = (row.mp_payer_email ?? "").trim();
          if (!payerEmail) {
            console.error("process-plan-changes: barbearia sem mp_payer_email, pulando", { id: row.id });
            failed += 1;
            continue;
          }

          const created = await createPlatformPreapproval({
            barbershopId: row.id,
            plan: "yearly",
            payerEmail,
            requestUrl: request.url,
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

        return Response.json({ processed: rows.length, upgraded, failed });
      },
    },
  },
});
