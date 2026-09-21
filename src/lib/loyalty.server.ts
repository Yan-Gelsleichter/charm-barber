/**
 * Cálculo do progresso de fidelidade — sempre computado na leitura, nunca
 * um contador gravado. "Conquistado" exige payment_status='pago' E
 * attendance_confirmed=true (comparecimento confirmado manualmente, não
 * o relógio passando — ver docs/add-loyalty-program.sql). "Gasto" é a
 * contagem de resgates já usados cujo agendamento vinculado não foi
 * cancelado; se for cancelado, o resgate reaparece automaticamente sem
 * nenhuma escrita extra. Usado tanto pelo endpoint de status (o que o
 * cliente vê) quanto pela validação ao criar um agendamento com resgate
 * (appointment-create.ts) — um único lugar com essa lógica.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (table: string) => any };

export type LoyaltyProgramStatus = {
  program: {
    id: string;
    barbershop_id: string;
    name: string;
    scope: "generic" | "services";
    goal: number;
    include_walk_in: boolean;
  };
  // Prêmio: atendimento grátis (agendado pelo app) e/ou produtos do catálogo.
  allowServiceReward: boolean;
  rewardProducts: { id: string; title: string; stock_quantity: number }[];
  serviceNames: string[];
  serviceIds: string[];
  totalEarned: number;
  totalSpent: number;
  availableNow: number;
  progressInCycle: number;
};

export async function computeLoyaltyStatus(
  admin: Admin,
  opts: { barbershopId: string; phone: string },
): Promise<LoyaltyProgramStatus[]> {
  const phone = opts.phone.trim();
  if (!phone) return [];

  const { data: programsData } = await admin
    .from("loyalty_programs")
    .select("*")
    .eq("barbershop_id", opts.barbershopId)
    .eq("active", true);
  const programs = (programsData ?? []) as {
    id: string;
    barbershop_id: string;
    name: string;
    scope: "generic" | "services";
    goal: number;
    include_walk_in: boolean;
    allow_service_reward?: boolean | null;
  }[];
  if (programs.length === 0) return [];

  const programIds = programs.map((p) => p.id);

  const [{ data: linksData }, { data: apptsData }, { data: redemptionsData }, { data: productLinksData }] =
    await Promise.all([
    admin.from("loyalty_program_services").select("program_id, service_id").in("program_id", programIds),
    admin
      .from("appointments")
      .select("id, service_id, service_ids, is_walk_in")
      .eq("barbershop_id", opts.barbershopId)
      .eq("customer_phone", phone)
      .eq("payment_status", "pago")
      .eq("attendance_confirmed", true),
    admin
      .from("loyalty_redemptions")
      .select("id, program_id, appointment_id")
      .eq("barbershop_id", opts.barbershopId)
      .eq("customer_phone", phone)
      .in("program_id", programIds),
    admin.from("loyalty_program_products").select("program_id, product_id").in("program_id", programIds),
  ]);

  // Só produtos ativos entram como opção de prêmio (o estoque aparece pra
  // o cliente saber se dá pra trocar agora).
  const productLinks = (productLinksData ?? []) as { program_id: string; product_id: string }[];
  const rewardProductById = new Map<string, { id: string; title: string; stock_quantity: number }>();
  if (productLinks.length > 0) {
    const { data: productsData } = await admin
      .from("products")
      .select("id, title, stock_quantity, active")
      .in("id", Array.from(new Set(productLinks.map((l) => l.product_id))));
    for (const p of (productsData ?? []) as {
      id: string;
      title: string;
      stock_quantity: number;
      active: boolean;
    }[]) {
      if (p.active) rewardProductById.set(p.id, { id: p.id, title: p.title, stock_quantity: p.stock_quantity });
    }
  }

  const links = (linksData ?? []) as { program_id: string; service_id: string }[];
  const appts = (apptsData ?? []) as {
    id: string;
    service_id: string;
    service_ids: string[] | null;
    is_walk_in: boolean | null;
  }[];
  const redemptions = (redemptionsData ?? []) as {
    id: string;
    program_id: string;
    appointment_id: string | null;
  }[];

  // Status de cada agendamento vinculado a um resgate — pra saber se
  // ainda "vale" ou se foi cancelado (e portanto liberou o resgate de novo).
  const redemptionApptIds = redemptions.map((r) => r.appointment_id).filter((id): id is string => !!id);
  let redeemedApptStatus = new Map<string, string>();
  if (redemptionApptIds.length > 0) {
    const { data: redeemedAppts } = await admin
      .from("appointments")
      .select("id, status")
      .in("id", redemptionApptIds);
    redeemedApptStatus = new Map(
      ((redeemedAppts ?? []) as { id: string; status: string }[]).map((a) => [a.id, a.status]),
    );
  }

  const serviceIdsByProgram = new Map<string, Set<string>>();
  for (const link of links) {
    const set = serviceIdsByProgram.get(link.program_id) ?? new Set<string>();
    set.add(link.service_id);
    serviceIdsByProgram.set(link.program_id, set);
  }

  let serviceNamesById = new Map<string, string>();
  if (links.length > 0) {
    const { data: servicesData } = await admin
      .from("services")
      .select("id, name")
      .in(
        "id",
        Array.from(new Set(links.map((l) => l.service_id))),
      );
    serviceNamesById = new Map(
      ((servicesData ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]),
    );
  }

  return programs.map((program) => {
    const eligibleServiceIds = serviceIdsByProgram.get(program.id) ?? new Set<string>();

    const totalEarned = appts.filter((a) => {
      if (!program.include_walk_in && a.is_walk_in) return false;
      if (program.scope === "generic") return true;
      const ids = a.service_ids?.length ? a.service_ids : [a.service_id];
      return ids.some((id) => eligibleServiceIds.has(id));
    }).length;

    const totalSpent = redemptions.filter((r) => {
      if (r.program_id !== program.id) return false;
      // Sem agendamento vinculado = resgate de produto (consumido de vez,
      // não volta se o pedido for cancelado). Com agendamento cancelado,
      // o resgate volta a ficar disponível.
      if (!r.appointment_id) return true;
      const status = (redeemedApptStatus.get(r.appointment_id) ?? "").trim().toLowerCase();
      return status !== "cancelado";
    }).length;

    const availableNow = Math.max(0, Math.floor(totalEarned / program.goal) - totalSpent);
    const progressInCycle = Math.max(0, totalEarned - totalSpent * program.goal);

    return {
      program: {
        id: program.id,
        barbershop_id: program.barbershop_id,
        name: program.name,
        scope: program.scope,
        goal: program.goal,
        include_walk_in: program.include_walk_in,
      },
      allowServiceReward: program.allow_service_reward !== false,
      rewardProducts: productLinks
        .filter((l) => l.program_id === program.id)
        .map((l) => rewardProductById.get(l.product_id))
        .filter((p): p is { id: string; title: string; stock_quantity: number } => !!p),
      serviceNames: Array.from(eligibleServiceIds).map((id) => serviceNamesById.get(id) ?? "Serviço"),
      serviceIds: Array.from(eligibleServiceIds),
      totalEarned,
      totalSpent,
      availableNow,
      progressInCycle,
    };
  });
}
