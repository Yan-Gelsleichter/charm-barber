/**
 * Helpers de assinatura (planos mensais) usados pelas rotas de servidor.
 *
 * A tabela `clients` é organizada por barbeiro (`barber_id` obrigatório),
 * não por barbearia — um mesmo cliente pode ter uma linha por barbeiro com
 * quem já agendou. Como uma assinatura NÃO fica presa a um barbeiro
 * específico, a cobertura é resolvida pela identidade do cliente
 * (usuário logado, telefone ou e-mail) dentro da barbearia inteira, e não
 * pela linha exata de `clients` usada num agendamento específico.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (table: string) => any };

/** Acha (ou cria) a linha de `clients` do assinante logado nesta barbearia. */
export async function findOrCreateSubscriberClient(
  admin: Admin,
  opts: { barbershopId: string; userId: string; name: string; email: string | null },
): Promise<string | null> {
  const existing = await admin
    .from("clients")
    .select("id")
    .eq("barbershop_id", opts.barbershopId)
    .eq("user_id", opts.userId)
    .limit(1)
    .maybeSingle();
  if (existing.data?.id) return String(existing.data.id);

  // clients.barber_id é obrigatório mesmo sem vínculo real com um barbeiro:
  // usamos o admin da barbearia como âncora técnica.
  const admins = await admin
    .from("barbers")
    .select("id")
    .eq("barbershop_id", opts.barbershopId)
    .eq("is_admin", true)
    .limit(1)
    .maybeSingle();
  const anchorBarberId = (admins.data as { id?: string } | null)?.id;
  if (!anchorBarberId) return null;

  const inserted = await admin
    .from("clients")
    .insert({
      barber_id: anchorBarberId,
      barbershop_id: opts.barbershopId,
      user_id: opts.userId,
      name: opts.name,
      email: opts.email,
    })
    .select("id")
    .maybeSingle();
  return inserted.data?.id ? String(inserted.data.id) : null;
}

/**
 * Verifica se a pessoa (por login, telefone ou e-mail) tem uma assinatura
 * ativa nesta barbearia cujo plano cobre o serviço informado E inclui o
 * barbeiro escolhido no agendamento — cada plano só é "de graça" com os
 * barbeiros que o admin marcou nele.
 */
export async function findActiveSubscriptionCoverage(
  admin: Admin,
  opts: {
    barbershopId: string;
    serviceId: string;
    barberId: string;
    userId?: string | null;
    phone?: string | null;
    email?: string | null;
  },
): Promise<{ subscriptionId: string } | null> {
  const filters: string[] = [];
  if (opts.userId) filters.push(`user_id.eq.${opts.userId}`);
  if (opts.phone) filters.push(`whatsapp.eq.${opts.phone}`);
  if (opts.email) filters.push(`email.eq.${opts.email.trim().toLowerCase()}`);
  if (filters.length === 0) return null;

  const clientRows = await admin
    .from("clients")
    .select("id")
    .eq("barbershop_id", opts.barbershopId)
    .or(filters.join(","));
  const clientIds = ((clientRows.data ?? []) as { id: string }[]).map((c) => c.id);
  if (clientIds.length === 0) return null;

  const subsRows = await admin
    .from("client_subscriptions")
    .select("id, plan_id")
    .eq("barbershop_id", opts.barbershopId)
    .eq("status", "active")
    .in("client_id", clientIds);
  const subscriptions = (subsRows.data ?? []) as { id: string; plan_id: string }[];
  if (subscriptions.length === 0) return null;

  const planIds = subscriptions.map((s) => s.plan_id);
  const [planServiceRows, planBarberRows] = await Promise.all([
    admin
      .from("subscription_plan_services")
      .select("plan_id")
      .eq("service_id", opts.serviceId)
      .in("plan_id", planIds),
    admin
      .from("subscription_plan_barbers")
      .select("plan_id")
      .eq("barber_id", opts.barberId)
      .in("plan_id", planIds),
  ]);
  const serviceCoveredPlanIds = new Set(
    ((planServiceRows.data ?? []) as { plan_id: string }[]).map((p) => p.plan_id),
  );
  const barberCoveredPlanIds = new Set(
    ((planBarberRows.data ?? []) as { plan_id: string }[]).map((p) => p.plan_id),
  );
  const match = subscriptions.find(
    (s) => serviceCoveredPlanIds.has(s.plan_id) && barberCoveredPlanIds.has(s.plan_id),
  );
  return match ? { subscriptionId: match.id } : null;
}
