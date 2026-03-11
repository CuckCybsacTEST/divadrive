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

export const supabaseAuth = appEnv.supabaseUrl && appEnv.supabaseAnonKey
  ? createClient(appEnv.supabaseUrl, appEnv.supabaseAnonKey, {
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
export const isSupabaseAuthReady = appEnv.supabaseEnabled && supabaseAuth !== null;
