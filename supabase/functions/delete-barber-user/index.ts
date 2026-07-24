// Supabase Edge Function: delete-barber-user
// Deletes a barber row AND the corresponding auth.users record.
// Only admins of the same barbershop can call it.
//
// Deploy:  supabase functions deploy delete-barber-user --no-verify-jwt=false
// Requires the standard SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY secrets (all provided by Supabase automatically).

// deno-lint-ignore-file
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "missing bearer token" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SERVICE_ROLE_KEY")!;

    // Client that impersonates the caller so RLS applies.
    const asUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthenticated" }, 401);
    const callerId = userData.user.id;

    const { barber_id } = await req.json().catch(() => ({}));
    if (!barber_id || typeof barber_id !== "string") {
      return json({ error: "barber_id required" }, 400);
    }

    // Service client — bypasses RLS for the actual deletion.
    const admin = createClient(SUPABASE_URL, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Load the target barber.
    const { data: target, error: tErr } = await admin
      .from("barbers")
      .select("id, user_id, barbershop_id")
      .eq("id", barber_id)
      .maybeSingle();
    if (tErr) return json({ error: tErr.message }, 500);
    if (!target) return json({ error: "barber not found" }, 404);

    // Ensure the caller is an admin of the same barbershop.
    const { data: caller, error: cErr } = await admin
      .from("barbers")
      .select("id, is_admin, barbershop_id")
      .eq("user_id", callerId)
      .eq("is_admin", true)
      .maybeSingle();
    if (cErr) return json({ error: cErr.message }, 500);
    if (!caller || caller.barbershop_id !== target.barbershop_id) {
      return json({ error: "forbidden" }, 403);
    }
    if (caller.id === target.id) {
      return json({ error: "cannot delete yourself" }, 400);
    }

    // Delete the auth user FIRST so we never end up with a deleted barber row
    // but an orphan auth.users record that blocks re-registration with the same e-mail.
    if (target.user_id) {
      const { error: authDelErr } = await admin.auth.admin.deleteUser(target.user_id);
      if (authDelErr && !/not.*found/i.test(authDelErr.message)) {
        return json(
          {
            error:
              `auth delete failed (barber NOT removed): ${authDelErr.message}. ` +
              `Verifique se a SUPABASE_SERVICE_ROLE_KEY nas Secrets do projeto corresponde a este projeto Supabase.`,
          },
          500,
        );
      }
    }

    const { error: delErr } = await admin.from("barbers").delete().eq("id", target.id);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
