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
 * ativa nesta barbearia cujo plano cobre TODOS os serviços escolhidos E
 * inclui o barbeiro escolhido no agendamento — cada plano só é "de graça"
 * com os barbeiros que o admin marcou nele, e um agendamento com mais de um
 * serviço só é coberto se o plano cobrir cada um deles (senão o cliente
 * pagaria a menos por um serviço fora do plano).
 */
export async function findActiveSubscriptionCoverage(
  admin: Admin,
  opts: {
    barbershopId: string;
    serviceIds: string[];
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
  if (filters.length === 0 || opts.serviceIds.length === 0) return null;

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
      .select("plan_id, service_id")
      .in("service_id", opts.serviceIds)
      .in("plan_id", planIds),
    admin
      .from("subscription_plan_barbers")
      .select("plan_id")
      .eq("barber_id", opts.barberId)
      .in("plan_id", planIds),
  ]);
  // Um plano só cobre o agendamento se tiver uma linha pra CADA serviço
  // escolhido — não basta cobrir um deles.
  const servicesPerPlan = new Map<string, Set<string>>();
  for (const row of (planServiceRows.data ?? []) as { plan_id: string; service_id: string }[]) {
    const set = servicesPerPlan.get(row.plan_id) ?? new Set<string>();
    set.add(row.service_id);
    servicesPerPlan.set(row.plan_id, set);
  }
  const allServicesCoveredPlanIds = new Set(
    Array.from(servicesPerPlan.entries())
      .filter(([, services]) => opts.serviceIds.every((id) => services.has(id)))
      .map(([planId]) => planId),
  );
  const barberCoveredPlanIds = new Set(
    ((planBarberRows.data ?? []) as { plan_id: string }[]).map((p) => p.plan_id),
  );
  const match = subscriptions.find(
    (s) => allServicesCoveredPlanIds.has(s.plan_id) && barberCoveredPlanIds.has(s.plan_id),
  );
  return match ? { subscriptionId: match.id } : null;
}

export interface CustomerSubscription {
  subscription_id: string;
  plan_id: string;
  plan_name: string;
  /** Todos os serviços que o plano cobre (de todos os barbeiros). */
  service_ids: string[];
  /** Barbeiros que atendem o plano — só com eles o serviço sai de graça. */
  barber_ids: string[];
}

/**
 * Assinaturas ativas de um cliente (achado por telefone/e-mail) nesta
 * barbearia, com os serviços e barbeiros de cada plano — usado pelo painel
 * pra mostrar "cliente assinante" ao agendar/registrar um atendimento.
 */
export async function listActiveSubscriptionsForCustomer(
  admin: Admin,
  opts: { barbershopId: string; phone?: string | null; email?: string | null },
): Promise<CustomerSubscription[]> {
  const filters: string[] = [];
  if (opts.phone) filters.push(`whatsapp.eq.${opts.phone}`);
  if (opts.email) filters.push(`email.eq.${opts.email.trim().toLowerCase()}`);
  if (filters.length === 0) return [];

  const clientRows = await admin
    .from("clients")
    .select("id")
    .eq("barbershop_id", opts.barbershopId)
    .or(filters.join(","));
  const clientIds = ((clientRows.data ?? []) as { id: string }[]).map((c) => c.id);
  if (clientIds.length === 0) return [];

  const subsRows = await admin
    .from("client_subscriptions")
    .select("id, plan_id")
    .eq("barbershop_id", opts.barbershopId)
    .eq("status", "active")
    .in("client_id", clientIds);
  const subscriptions = (subsRows.data ?? []) as { id: string; plan_id: string }[];
  if (subscriptions.length === 0) return [];

  const planIds = Array.from(new Set(subscriptions.map((s) => s.plan_id)));
  const [plans, planServices, planBarbers] = await Promise.all([
    admin.from("subscription_plans").select("id, name").in("id", planIds),
    admin.from("subscription_plan_services").select("plan_id, service_id").in("plan_id", planIds),
    admin.from("subscription_plan_barbers").select("plan_id, barber_id").in("plan_id", planIds),
  ]);
  const planName = new Map(((plans.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const servicesOf = new Map<string, string[]>();
  for (const r of (planServices.data ?? []) as { plan_id: string; service_id: string }[]) {
    servicesOf.set(r.plan_id, [...(servicesOf.get(r.plan_id) ?? []), r.service_id]);
  }
  const barbersOf = new Map<string, string[]>();
  for (const r of (planBarbers.data ?? []) as { plan_id: string; barber_id: string }[]) {
    barbersOf.set(r.plan_id, [...(barbersOf.get(r.plan_id) ?? []), r.barber_id]);
  }

  return subscriptions.map((s) => ({
    subscription_id: s.id,
    plan_id: s.plan_id,
    plan_name: planName.get(s.plan_id) ?? "Plano",
    service_ids: servicesOf.get(s.plan_id) ?? [],
    barber_ids: barbersOf.get(s.plan_id) ?? [],
  }));
}

/**
 * A assinatura (já escolhida pelo painel) é desta barbearia, está ativa e o
 * plano cobre TODOS os serviços informados e inclui o barbeiro? Reconfere no
 * servidor — nunca confia no que a tela mostrou.
 */
export async function subscriptionCoversServices(
  admin: Admin,
  opts: { barbershopId: string; subscriptionId: string; serviceIds: string[]; barberId: string },
): Promise<boolean> {
  const sub = await admin
    .from("client_subscriptions")
    .select("id, plan_id")
    .eq("id", opts.subscriptionId)
    .eq("barbershop_id", opts.barbershopId)
    .eq("status", "active")
    .maybeSingle();
  const planId = (sub.data as { plan_id?: string } | null)?.plan_id;
  if (!planId || opts.serviceIds.length === 0) return false;

  const [planServices, planBarber] = await Promise.all([
    admin.from("subscription_plan_services").select("service_id").eq("plan_id", planId).in("service_id", opts.serviceIds),
    admin.from("subscription_plan_barbers").select("plan_id").eq("plan_id", planId).eq("barber_id", opts.barberId).limit(1),
  ]);
  const covered = new Set(((planServices.data ?? []) as { service_id: string }[]).map((r) => r.service_id));
  return opts.serviceIds.every((id) => covered.has(id)) && ((planBarber.data ?? []) as unknown[]).length > 0;
}
