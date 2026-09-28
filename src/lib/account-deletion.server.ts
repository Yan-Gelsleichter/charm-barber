/**
 * Exclusão de conta (Play Store + LGPD). Toda a regra de negócio mora aqui —
 * reaproveitada tanto pelo botão no Perfil/`meus-agendamentos` quanto pela
 * página pública `/excluir-dados`, através do endpoint único
 * `api/public/account-delete.ts`.
 *
 * Princípio geral: só apaga de verdade dado pessoal "solto" (nome/telefone/
 * e-mail em `clients`; nome/foto/login em `barbers`). Registros financeiros/
 * operacionais (`appointments`, `product_orders`) são ANONIMIZADOS, nunca
 * apagados — a barbearia precisa deles pra faturamento e obrigação fiscal.
 * `loyalty_redemptions` nunca é tocada: é organizada pelo telefone, não pela
 * conta, então sobrevive a uma exclusão (se a pessoa reativar com o mesmo
 * telefone, mantém o progresso).
 */

import type { createSupabaseAdmin } from "@/lib/supabase-admin.server";
import { filterActiveAppointments } from "@/lib/availability";
import { cancelPlatformPreapproval } from "@/lib/platform-subscription.server";
import { cancelClientSubscriptionPreapproval } from "@/lib/subscription.server";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdmin>>;

const ANON_CLIENT_NAME = "Cliente removido";
const ANON_BARBER_NAME = "Barbeiro removido";

export interface AccountDeletionPreview {
  blocked: boolean;
  reasons: string[];
  summary: string[];
  /** Fim do período já pago de uma assinatura de cliente ainda ativa, se houver. */
  activeSubscriptionUntil: string | null;
}

interface ClientRole {
  id: string;
  barbershop_id: string | null;
  whatsapp: string | null;
  email: string | null;
}
interface BarberRole {
  id: string;
  barbershop_id: string | null;
  is_admin: boolean;
}
interface ShopRow {
  id: string;
  subscription_status: string | null;
  subscription_id: string | null;
  cancel_at_period_end: boolean | null;
  current_period_ends_at: string | null;
}

async function loadRoles(
  admin: AdminClient,
  userId: string,
): Promise<{ clients: ClientRole[]; barbers: BarberRole[] }> {
  const [clientsRes, barbersRes] = await Promise.all([
    admin.from("clients").select("id, barbershop_id, whatsapp, email").eq("user_id", userId),
    admin.from("barbers").select("id, barbershop_id, is_admin").eq("user_id", userId),
  ]);
  return {
    clients: (clientsRes.data ?? []) as ClientRole[],
    barbers: (barbersRes.data ?? []) as BarberRole[],
  };
}

/** Agendamentos futuros e ainda ativos (já resolve marcadores de cancelamento) de um filtro simples. */
async function futureActiveAppointments(
  admin: AdminClient,
  column: "barber_id" | "barbershop_id",
  value: string,
): Promise<{ id: string }[]> {
  const { data } = await admin
    .from("appointments")
    .select("id, appointment_time, status, customer_name")
    .eq(column, value);
  const rows = (data ?? []) as { id: string; appointment_time: string; status: string; customer_name: string }[];
  const now = Date.now();
  return filterActiveAppointments(rows).filter((a) => new Date(a.appointment_time).getTime() > now);
}

interface BarberClassification {
  shop: ShopRow | null;
  isLastAdmin: boolean;
  hasOtherBarber: boolean;
}

/** Situação da barbearia do barbeiro, pra decidir entre "sai sozinho" e "encerra a barbearia". */
async function classifyBarber(admin: AdminClient, barber: BarberRole): Promise<BarberClassification> {
  if (!barber.barbershop_id) return { shop: null, isLastAdmin: false, hasOtherBarber: false };

  const [shopRes, otherAdminsRes, otherBarbersRes] = await Promise.all([
    admin
      .from("barbershops")
      .select("id, subscription_status, subscription_id, cancel_at_period_end, current_period_ends_at")
      .eq("id", barber.barbershop_id)
      .maybeSingle(),
    admin
      .from("barbers")
      .select("id", { count: "exact", head: true })
      .eq("barbershop_id", barber.barbershop_id)
      .eq("is_admin", true)
      .neq("id", barber.id),
    admin
      .from("barbers")
      .select("id", { count: "exact", head: true })
      .eq("barbershop_id", barber.barbershop_id)
      .neq("id", barber.id),
  ]);

  const shop = (shopRes.data as ShopRow | null) ?? null;
  const hasOtherAdmin = (otherAdminsRes.count ?? 0) > 0;
  const hasOtherBarber = (otherBarbersRes.count ?? 0) > 0;

  return { shop, isLastAdmin: barber.is_admin && !hasOtherAdmin, hasOtherBarber };
}

export async function previewAccountDeletion(admin: AdminClient, userId: string): Promise<AccountDeletionPreview> {
  const roles = await loadRoles(admin, userId);
  const reasons: string[] = [];
  const summary: string[] = [];
  let activeSubscriptionUntil: string | null = null;

  if (roles.clients.length > 0) {
    const clientIds = roles.clients.map((c) => c.id);
    const { data: subs } = await admin
      .from("client_subscriptions")
      .select("status, current_period_end")
      .in("client_id", clientIds)
      .neq("status", "cancelled");
    const subRows = (subs ?? []) as { status: string; current_period_end: string | null }[];
    for (const s of subRows) {
      if (s.status === "active" && s.current_period_end) {
        if (!activeSubscriptionUntil || s.current_period_end > activeSubscriptionUntil) {
          activeSubscriptionUntil = s.current_period_end;
        }
      }
    }
    if (subRows.length > 0) {
      summary.push("Suas assinaturas de plano serão canceladas imediatamente no Mercado Pago.");
    }
    summary.push("Seus agendamentos futuros serão cancelados.");
    summary.push(
      "Seu nome, telefone e e-mail serão apagados dos seus dados; o histórico de atendimentos da barbearia continua existindo, mas sem identificar você.",
    );
    summary.push("Seu progresso no programa de fidelidade fica guardado pelo telefone, caso você volte um dia.");
  }

  for (const b of roles.barbers) {
    if (!b.barbershop_id) {
      summary.push("Sua conta de barbeiro será removida.");
      continue;
    }
    const { shop, isLastAdmin, hasOtherBarber } = await classifyBarber(admin, b);

    if (!isLastAdmin) {
      const future = await futureActiveAppointments(admin, "barber_id", b.id);
      if (future.length > 0) {
        reasons.push(
          `Você tem ${future.length} agendamento${future.length === 1 ? "" : "s"} futuro${future.length === 1 ? "" : "s"} atribuído${future.length === 1 ? "" : "s"} a você. Peça para o admin reatribuir ou cancelar antes de excluir sua conta.`,
        );
      } else {
        summary.push("Sua conta de barbeiro será desativada e seu nome removido do sistema.");
      }
      continue;
    }

    // Único admin da barbearia — checagens de segurança antes de liberar o
    // encerramento completo do tenant.
    const subscriptionActive = shop?.subscription_status === "active" && !shop?.cancel_at_period_end;
    if (subscriptionActive) {
      reasons.push(
        "A barbearia ainda tem uma assinatura ativa na plataforma. Cancele a assinatura no Perfil antes de excluir sua conta.",
      );
    }
    const shopFuture = await futureActiveAppointments(admin, "barbershop_id", b.barbershop_id);
    if (shopFuture.length > 0) {
      reasons.push(
        `A barbearia tem ${shopFuture.length} agendamento${shopFuture.length === 1 ? "" : "s"} futuro${shopFuture.length === 1 ? "" : "s"} (de qualquer barbeiro). Resolva-os antes de excluir sua conta.`,
      );
    }
    if (hasOtherBarber) {
      reasons.push(
        "Ainda há outros barbeiros cadastrados nesta barbearia. Remova-os na aba Barbeiros antes de excluir sua conta.",
      );
    }
    if (subscriptionActive === false && shopFuture.length === 0 && !hasOtherBarber) {
      summary.push(
        "Você é o único admin: a barbearia inteira será encerrada. O histórico de agendamentos e vendas fica anonimizado, e clientes não conseguirão mais agendar por lá.",
      );
    }
  }

  return { blocked: reasons.length > 0, reasons, summary, activeSubscriptionUntil };
}

/** Cancela (imediato) e anonimiza tudo que pertence a um cliente numa barbearia específica. */
async function wipeClientData(admin: AdminClient, barbershopId: string, phone: string): Promise<void> {
  const { data } = await admin
    .from("appointments")
    .select("id, appointment_time, status, customer_name")
    .eq("barbershop_id", barbershopId)
    .eq("customer_phone", phone);
  const rows = (data ?? []) as { id: string; appointment_time: string; status: string; customer_name: string }[];

  if (rows.length > 0) {
    const now = Date.now();
    const futureActiveIds = filterActiveAppointments(rows)
      .filter((a) => new Date(a.appointment_time).getTime() > now)
      .map((a) => a.id);
    if (futureActiveIds.length > 0) {
      await admin.from("appointments").update({ status: "cancelado" }).in("id", futureActiveIds);
    }
    const allIds = rows.map((a) => a.id);
    await admin
      .from("appointments")
      .update({ customer_name: ANON_CLIENT_NAME, customer_phone: "", email: null })
      .in("id", allIds);
  }

  await admin
    .from("product_orders")
    .update({ customer_name: ANON_CLIENT_NAME, customer_phone: null, customer_email: null })
    .eq("barbershop_id", barbershopId)
    .eq("customer_phone", phone);
}

async function cancelClientOwnSubscriptions(admin: AdminClient, clientId: string): Promise<void> {
  const { data } = await admin
    .from("client_subscriptions")
    .select("id, mp_preapproval_id, barbershop_id")
    .eq("client_id", clientId)
    .neq("status", "cancelled");
  for (const s of (data ?? []) as { id: string; mp_preapproval_id: string | null; barbershop_id: string }[]) {
    await cancelClientSubscriptionPreapproval(admin, s);
    await admin.from("client_subscriptions").update({ status: "cancelled", cancel_at_period_end: false }).eq("id", s.id);
  }
}

/** Encerramento completo do tenant — só chamado quando o preview já garantiu que está tudo liberado. */
async function closeBarbershop(admin: AdminClient, barbershopId: string, shop: ShopRow | null): Promise<void> {
  if (shop?.subscription_id) {
    await cancelPlatformPreapproval(shop.subscription_id).catch(() => false);
  }
  const { data: subs } = await admin
    .from("client_subscriptions")
    .select("id, mp_preapproval_id, barbershop_id")
    .eq("barbershop_id", barbershopId)
    .in("status", ["active", "authorized", "pending", "paused"]);
  for (const s of (subs ?? []) as { id: string; mp_preapproval_id: string | null; barbershop_id: string }[]) {
    await cancelClientSubscriptionPreapproval(admin, s);
    await admin.from("client_subscriptions").update({ status: "cancelled", cancel_at_period_end: false }).eq("id", s.id);
  }

  await admin
    .from("appointments")
    .update({ customer_name: ANON_CLIENT_NAME, customer_phone: "", email: null })
    .eq("barbershop_id", barbershopId);
  await admin
    .from("product_orders")
    .update({ customer_name: ANON_CLIENT_NAME, customer_phone: null, customer_email: null })
    .eq("barbershop_id", barbershopId);

  // Loyalty fica preservada (pelo telefone) — não é tocada aqui de propósito.
  await admin.from("clients").delete().eq("barbershop_id", barbershopId);

  const { error } = await admin
    .from("barbershops")
    .update({ closed_at: new Date().toISOString() } as never)
    .eq("id", barbershopId);
  if (error) console.error("[account-deletion] falha ao marcar barbearia como encerrada", error);
}

async function anonymizeBarber(admin: AdminClient, barberId: string): Promise<void> {
  await admin.from("push_subscriptions").delete().eq("barber_id", barberId);
  await admin
    .from("barbers")
    .update({
      name: ANON_BARBER_NAME,
      avatar_url: null,
      user_id: null,
      mp_user_id: null,
      mp_access_token: null,
      mp_refresh_token: null,
      mp_webhook_secret: null,
      bg_home: null,
      bg_tabs: null,
      bg_custom: [],
    } as never)
    .eq("id", barberId);
}

export async function performAccountDeletion(
  admin: AdminClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; reasons: string[] }> {
  // Nunca confia num preview antigo — reconfere tudo agora, na hora de escrever.
  const preview = await previewAccountDeletion(admin, userId);
  if (preview.blocked) return { ok: false, reasons: preview.reasons };

  const roles = await loadRoles(admin, userId);

  for (const c of roles.clients) {
    await cancelClientOwnSubscriptions(admin, c.id);
    if (c.barbershop_id && c.whatsapp) {
      await wipeClientData(admin, c.barbershop_id, c.whatsapp);
    }
  }
  if (roles.clients.length > 0) {
    await admin.from("clients").delete().eq("user_id", userId);
  }

  for (const b of roles.barbers) {
    if (b.barbershop_id) {
      const { shop, isLastAdmin } = await classifyBarber(admin, b);
      if (isLastAdmin) {
        await closeBarbershop(admin, b.barbershop_id, shop);
      }
    }
    await anonymizeBarber(admin, b.id);
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("[account-deletion] falha ao apagar o login", error);
    return { ok: false, reasons: [`Os dados foram limpos, mas não foi possível apagar o login: ${error.message}`] };
  }
  return { ok: true };
}
