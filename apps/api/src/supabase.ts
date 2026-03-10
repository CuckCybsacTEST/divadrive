import { createClient } from "@supabase/supabase-js";
import { appEnv, hasSupabaseConfig } from "./env.js";

export const supabaseAdmin = hasSupabaseConfig
  ? createClient(appEnv.supabaseUrl, appEnv.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      db: {
        schema: appEnv.supabaseSchema
      }
    })
  : null;

export const isSupabaseReady = appEnv.supabaseEnabled && supabaseAdmin !== null;
