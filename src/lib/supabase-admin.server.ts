import { createClient } from "@supabase/supabase-js";

/**
 * Cliente administrativo compatível tanto com chaves JWT antigas quanto com
 * as novas chaves opacas sb_secret_*. Deve ser criado dentro de cada request.
 */
export function createSupabaseAdmin() {
  const url =
    process.env["SUPABASE_URL"] ||
    process.env["SB_URL"] ||
    process.env["VITE_SUPABASE_URL"] ||
    (import.meta.env.VITE_SUPABASE_URL as string | undefined);
  const key =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ||
    process.env["SB_SERVICE_ROLE_KEY"] ||
    process.env["SERVICE_ROLE_KEY"];

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}