
import { createClient } from "@supabase/supabase-js";
import { mpPlatformCredentials } from "@/lib/mp-platform.server";
import { mapPaymentStatus } from "@/lib/mp-status.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (table: string) => any };

function isMissingColumn(error: { message?: string; code?: string } | null) {
  return !!error && (error.code === "42703" || /column .* does not exist/i.test(error.message ?? ""));
}

export type MpTenant = {
  kind: "barber" | "barbershop" | "platform";
  id: string | null;
  accessToken: string | null;
  webhookSecret: string | null;
};

async function fetchTenantRow(
  admin: Admin,
  table: "barbers" | "barbershops",
  column: string,
  value: string,
) {
  const full = await admin
    .from(table)
    .select(`id, mp_access_token, mp_webhook_secret`)
    .eq(column, value)
    .maybeSingle();
  if (!full.error) {
    return full.data as
      | { id?: string; mp_access_token?: string | null; mp_webhook_secret?: string | null }
      | null;
  }
  if (!isMissingColumn(full.error)) return null;
  const basic = await admin
    .from(table)
    .select("id, mp_access_token")
    .eq(column, value)
    .maybeSingle();
  return (basic.data ?? null) as
    | { id?: string; mp_access_token?: string | null; mp_webhook_secret?: string | null }
    | null;
}

function tenantFromRow(kind: "barber" | "barbershop", row: {
  id?: string;
  mp_access_token?: string | null;
  mp_webhook_secret?: string | null;
} | null): MpTenant | null {
  if (!row) return null;
  if (!row.mp_access_token && !row.mp_webhook_secret) return null;
  return {
    kind,
    id: row.id ?? null,
    accessToken: row.mp_access_token ?? null,
    webhookSecret: row.mp_webhook_secret ?? null,
  };
}

async function resolveTenant(
  admin: Admin,
  collectorId: string | null,
  paymentId: string,
  preferenceId?: string | null,
): Promise<MpTenant | null> {
  if (collectorId) {
    const barber = tenantFromRow("barber", await fetchTenantRow(admin, "barbers", "mp_user_id", collectorId));
    if (barber) return barber;
    const shop = tenantFromRow(
      "barbershop",
      await fetchTenantRow(admin, "barbershops", "mp_user_id", collectorId),
    );
    if (shop) return shop;
  }

  const refs = [paymentId, preferenceId ? `pref:${preferenceId}` : null, preferenceId].filter(
    Boolean,
  ) as string[];
  for (const ref of refs) {
    const { data: appt } = await admin
      .from("appointments")
      .select("barbershop_id, barber_id")
      .eq("mp_payment_id", ref)
      .maybeSingle();
    const row = appt as { barbershop_id?: string | null; barber_id?: string | null } | null;
    if (row?.barber_id) {
      const barber = tenantFromRow("barber", await fetchTenantRow(admin, "barbers", "id", row.barber_id));
      if (barber) return barber;
    }
    if (row?.barbershop_id) {
      const shop = tenantFromRow(
        "barbershop",
        await fetchTenantRow(admin, "barbershops", "id", row.barbershop_id),
      );
      if (shop) return shop;
    }
  }

  const platform = mpPlatformCredentials();
  if (platform?.accessToken) {
    return { kind: "platform", id: null, accessToken: platform.accessToken, webhookSecret: null };
  }
  return null;
}

function isMissingTable(error: { message?: string; code?: string } | null) {
  return !!error && (error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? ""));
}

function isDuplicate(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === "23505" || /duplicate key/i.test(error.message ?? ""));
}

function methodLabel(payment: { payment_type_id?: string; payment_method_id?: string }) {
  const type = (payment.payment_type_id ?? "").toLowerCase();
  if (type === "credit_card") return "credit_card";
  if (type === "debit_card") return "debit_card";
  if (type === "bank_transfer" || payment.payment_method_id === "pix") return "pix";
  return payment.payment_method_id ?? type ?? "outro";
}

type PaymentPayload = {
  id?: number | string;
  status?: string;
  status_detail?: string;
  payment_type_id?: string;
  payment_method_id?: string;
  external_reference?: string;
  preference_id?: string;
  order?: { id?: number | string; type?: string };
  metadata?: { appointment_id?: string; preference_id?: string };
};

async function fetchPayment(accessToken: string, paymentId: string) {
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json().catch(() => ({}))) as PaymentPayload;
  return { ok: res.ok, status: res.status, payment: body };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveAppointmentId(
  admin: Admin,
  payment: PaymentPayload,
  paymentId: string,
  preferenceId?: string | null,
): Promise<string | null> {
  // 1. Tenta achar pelo ID direto (caso venha no external_reference ou metadata)
  const direct =
    payment.external_reference?.split(":")[0]?.trim() ||
    payment.metadata?.appointment_id ||
    null;
  if (direct && UUID_RE.test(direct)) {
    const { data } = await admin
      .from("appointments")
      .select("id")
      .eq("id", direct)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  // 2. Tenta achar se o mp_payment_id já é o ID numérico do pagamento
  const { data: byPayment } = await admin
    .from("appointments")
    .select("id")
    .eq("mp_payment_id", paymentId)
    .maybeSingle();
  if (byPayment?.id) return byPayment.id as string;

  // 3. NOVO: Tenta achar se o mp_payment_id contém a preferência gravada (ex: pref:1110192221-...)
  const rawPref = preferenceId || payment.preference_id || payment.metadata?.preference_id || null;
  const prefId = rawPref ? String(rawPref).split("/").filter(Boolean).pop() : null;
  if (prefId) {
    const { data: byPref } = await admin
      .from("appointments")
      .select("id")
      .ilike("mp_payment_id", `%${prefId}%`)
      .maybeSingle();
    if (byPref?.id) return byPref.id as string;
  }

  // 4. NOVO FALLBACK PARA CHECKOUT PRO: Procura pela preferência dentro do external_reference se houver
  if (payment.external_reference) {
    const { data: byExt } = await admin
      .from("appointments")
      .select("id")
      .ilike("mp_payment_id", `%${payment.external_reference}%`)
      .maybeSingle();
    if (byExt?.id) return byExt.id as string;
  }

  return null;
}

async function applyPayment(
  admin: Admin,
  payment: PaymentPayload,
  paymentId: string,
  eventId: string,
  preferenceId?: string | null,
) {
  const appointmentId = await resolveAppointmentId(admin, payment, paymentId, preferenceId);
  
  if (!appointmentId) {
    console.warn("Webhook MP: agendamento não localizado para o pagamento", { paymentId, preferenceId });
    await admin.from("mp_webhook_events").insert({
      event_id: eventId,
      payment_id: paymentId,
      status: payment.status,
    }).maybeSingle();
    return new Response("no appointment found", { status: 200 });
  }

  const paymentStatus = mapPaymentStatus(payment.status);

  let claimed = false;
  const { error: claimError } = await admin.from("mp_webhook_events").insert({
    event_id: eventId,
    payment_id: paymentId,
    appointment_id: appointmentId,
    status: paymentStatus,
  });
  if (claimError && !isDuplicate(claimError)) {
    console.error("Webhook MP: falha ao registrar evento", claimError);
  } else {
    claimed = true;
  }

  const isApproved = paymentStatus === "pago" || payment.status === "approved";

  // Aqui está o pulo do gato: quando for aprovado, ele substitui o "pref:..." 
  // pelo ID numérico real do pagamento (igualzinho funcionava no Transparent Checkout!)
  const values: Record<string, unknown> = {
    payment_status: isApproved ? "pago" : paymentStatus,
    payment_method: methodLabel(payment),
    mp_payment_id: paymentId, // Atualiza para o ID numérico real do Mercado Pago
    paid_at: isApproved ? new Date().toISOString() : null,
  };

  const { error } = await admin.from("appointments").update(values).eq("id", appointmentId);

  if (error) {
    console.error("Webhook MP: falha ao atualizar agendamento", error);
    if (claimed) {
      await admin.from("mp_webhook_events").delete().eq("event_id", eventId);
    }
  } else if (isApproved) {
    await admin
      .from("appointments")
      .update({ status: "confirmado" })
      .eq("id", appointmentId);
      
    console.log(`✅ SUCESSO! Checkout Pro processado: Agendamento ${appointmentId} atualizado para PAGO (mp_payment_id: ${paymentId}).`);
  }

  return new Response("ok", { status: 200 });
}

function pickOrderPayment(payments: PaymentPayload[]) {
  const priority = ["approved", "authorized", "refunded", "charged_back", "in_process", "pending"];
  const sorted = [...payments].sort((a, b) => {
    const ia = priority.indexOf((a.status ?? "").toLowerCase());
    const ib = priority.indexOf((b.status ?? "").toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return sorted[0];
}

type RawNotification = {
  id?: number | string;
  type?: string;
  topic?: string;
  action?: string;
  user_id?: number | string;
  data?: { id?: number | string };
  resource?: string;
};

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type SignatureResult = "valid" | "unsigned" | "invalid" | "stale" | "no-secret";

async function verifySignature(
  request: Request,
  url: URL,
  dataId: string,
  tenantSecret?: string | null,
): Promise<SignatureResult> {
  const secret =
    (tenantSecret ?? "").trim() || (process.env["MP_WEBHOOK_SECRET"] ?? "").trim();
  if (!secret) return "no-secret";

  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const parts = Object.fromEntries(
    signature
      .split(",")
      .map((p) => p.split("=").map((s) => s.trim()))
      .filter((p) => p.length === 2) as [string, string][],
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return "unsigned";

  const tsMs = Number(ts) * (String(ts).length > 12 ? 1 : 1000);
  if (Number.isFinite(tsMs) && Math.abs(Date.now() - tsMs) > 10 * 60 * 1000) return "stale";

  const id = (url.searchParams.get("data.id") ?? dataId).toLowerCase();
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const expected = await hmacSha256Hex(secret, manifest);
  if (!timingSafeEqualHex(expected, v1.toLowerCase())) return "invalid";
  return "valid";
}

async function handleNotification(request: Request) {
  const url = new URL(request.url);
  const raw = (await request.json().catch(() => ({}))) as RawNotification;

  const topic = raw.type ?? raw.topic ?? url.searchParams.get("topic") ?? url.searchParams.get("type") ?? "";
  const isOrder = topic.includes("merchant_order");
  if (topic && !topic.includes("payment") && !isOrder) {
    return new Response("ignored", { status: 200 });
  }

  const resourceId = raw.resource ? String(raw.resource).split("/").filter(Boolean).pop() : null;
  const notificationId = String(
    raw.data?.id ?? resourceId ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "",
  ).trim();
  if (!notificationId) return new Response("no payment id", { status: 200 });

  const action = raw.action ?? url.searchParams.get("action") ?? topic ?? "payment";

  const supabaseUrl =
    process.env["SUPABASE_URL"] || process.env["SB_URL"] || process.env["VITE_SUPABASE_URL"];
  const serviceKey =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    process.env["SB_SERVICE_ROLE_KEY"] ||
    process.env["SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !serviceKey) return new Response("misconfigured", { status: 500 });

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const collectorId = raw.user_id != null ? String(raw.user_id) : url.searchParams.get("user_id");
  const preferenceId = url.searchParams.get("preference_id");
  const tenant = await resolveTenant(admin, collectorId, isOrder ? "" : notificationId, preferenceId);
  if (!tenant?.accessToken) return new Response("unknown account", { status: 200 });
  const accessToken = tenant.accessToken;

  const signature = await verifySignature(request, url, notificationId, tenant.webhookSecret);
  if (signature === "invalid" || signature === "stale") return new Response("ok", { status: 200 });

  if (isOrder) {
    const orderRes = await fetch(
      `https://api.mercadopago.com/merchant_orders/${encodeURIComponent(notificationId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const order = (await orderRes.json().catch(() => ({}))) as {
      external_reference?: string;
      preference_id?: string;
      payments?: PaymentPayload[];
    };
    if (!orderRes.ok) return new Response("order fetch failed", { status: 200 });
    const chosen = pickOrderPayment(order.payments ?? []);
    if (!chosen?.id) return new Response("no payment in order", { status: 200 });

    const paymentId = String(chosen.id);
    const detail = await fetchPayment(accessToken, paymentId);
    const payment: PaymentPayload = detail.ok ? detail.payment : chosen;
    if (!payment.external_reference && order.external_reference) {
      payment.external_reference = order.external_reference;
    }
    return applyPayment(admin, payment, paymentId, `${paymentId}:${payment.status ?? action}`, order.preference_id ?? preferenceId);
  }

  const { ok, payment } = await fetchPayment(accessToken, notificationId);
  if (!ok) return new Response("payment fetch failed", { status: 200 });

  const eventId = String(raw.id ?? url.searchParams.get("id_event") ?? `${notificationId}:${action}`).trim();
  const finalPreferenceId = preferenceId || payment.preference_id || null;
  return applyPayment(admin, payment, notificationId, eventId, finalPreferenceId);
}

export { handleNotification };
