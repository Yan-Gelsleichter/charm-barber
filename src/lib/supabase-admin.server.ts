import { createClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "@/integrations/supabase/config";

/**
 * Cliente administrativo compatível tanto com chaves JWT antigas quanto com
 * as novas chaves opacas sb_secret_*. Deve ser criado dentro de cada request.
 */
export function createSupabaseAdmin() {
  // SB_* identifica a mesma instância própria usada pelo navegador. Não há
  // fallback para outro projeto: sem essas credenciais a operação deve falhar.
  const url = process.env["SB_URL"];
  const key = process.env["SB_SERVICE_ROLE_KEY"];

  if (!url || !key) return null;

  // Impede o servidor de confirmar uma gravação em uma instância diferente
  // daquela consultada pelo navegador e pelo painel.
  if (url.replace(/\/$/, "") !== SUPABASE_URL.replace(/\/$/, "")) {
    console.error("[database] configuração divergente entre API e aplicativo");
    return null;
  }

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