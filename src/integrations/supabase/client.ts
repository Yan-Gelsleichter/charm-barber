import { createClient } from "@supabase/supabase-js";
import type { Database } from "./db-types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

const url = SUPABASE_URL;
const key = SUPABASE_PUBLISHABLE_KEY;


export const supabase = createClient<Database>(url, key, {
  auth: {
    persistSession: typeof window !== "undefined",
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
