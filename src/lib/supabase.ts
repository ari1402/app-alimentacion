import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CLOUD, SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

export const supabase: SupabaseClient | null = CLOUD
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
