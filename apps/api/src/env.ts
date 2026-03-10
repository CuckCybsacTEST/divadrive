import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_DB_SCHEMA: z.string().min(1).default("public"),
  SUPABASE_ENABLED: z.enum(["true", "false"]).default("false")
});

const parsedEnv = envSchema.parse(process.env);

export const appEnv = {
  supabaseUrl: parsedEnv.SUPABASE_URL ?? "",
  supabaseAnonKey: parsedEnv.SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: parsedEnv.SUPABASE_SERVICE_ROLE_KEY ?? "",
  supabaseSchema: parsedEnv.SUPABASE_DB_SCHEMA,
  supabaseEnabled: parsedEnv.SUPABASE_ENABLED === "true"
};

export const hasSupabaseConfig =
  Boolean(appEnv.supabaseUrl) && Boolean(appEnv.supabaseServiceRoleKey);
