import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db-types";

/**
 * Typed client for the application's existing database.
 *
 * The generated Lovable Cloud client points to the newly provisioned backend,
 * while this application still stores its users and business data in the
 * original backend exposed through the SB_* compatibility binding.
 */
const url = "https://axuvfztbyfmswpcveujo.supabase.co";
const publishableKey = "sb_publishable_pdUbjMiCu-ZXE6K2kh_umA_AjwtS9Oa";

if (!url || !publishableKey) {
  throw new Error("A conexão com o banco de dados do aplicativo não está configurada.");
}

export const supabase: SupabaseClient<Database> = createClient<Database>(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});