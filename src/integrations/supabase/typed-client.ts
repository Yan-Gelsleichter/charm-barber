import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase as generatedSupabase } from "./client";
import type { Database } from "./db-types";

/**
 * Typed facade for the generated browser client.
 *
 * The generated schema currently contains no public tables, while db-types
 * mirrors the application's existing database schema. Keeping this adapter
 * separate avoids editing generated integration files.
 */
export const supabase = generatedSupabase as unknown as SupabaseClient<Database>;