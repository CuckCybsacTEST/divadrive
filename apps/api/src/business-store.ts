import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PROMOTIONS,
  type BusinessRulesSnapshot
} from "@diva-drive/domain";
import { isSupabaseReady, supabaseAdmin } from "./supabase.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const dataDir = resolve(currentDir, "../data");
const businessFile = resolve(dataDir, "business.json");

const defaultBusinessRules: BusinessRulesSnapshot = {
  pricing: DEFAULT_PRICING_CONFIG,
  promotions: DEFAULT_PROMOTIONS,
  auditLog: []
};

const ensureDataFile = async () => {
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(businessFile, "utf8");
  } catch {
    await writeFile(businessFile, `${JSON.stringify(defaultBusinessRules, null, 2)}\n`, "utf8");
  }
};

export const readLocalBusinessRules = async (): Promise<BusinessRulesSnapshot> => {
  await ensureDataFile();
  const content = await readFile(businessFile, "utf8");
  return JSON.parse(content) as BusinessRulesSnapshot;
};

export const writeLocalBusinessRules = async (payload: BusinessRulesSnapshot) => {
  await ensureDataFile();
  await writeFile(businessFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

export const readBusinessRules = async (): Promise<BusinessRulesSnapshot> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return readLocalBusinessRules();
  }

  const [
    { data: configRow, error: configError },
    { data: promotions, error: promotionsError },
    { data: auditLog, error: auditError }
  ] = await Promise.all([
    supabaseAdmin
      .from("business_config")
      .select("pricing, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.from("promotions").select("*").order("created_at", { ascending: false }),
    supabaseAdmin
      .from("business_audit_log")
      .select("*")
      .order("occurred_at", { ascending: false })
  ]);

  if (configError) {
    throw configError;
  }

  if (promotionsError) {
    throw promotionsError;
  }

  if (auditError) {
    throw auditError;
  }

  return {
    pricing: (configRow?.pricing as BusinessRulesSnapshot["pricing"]) ?? DEFAULT_PRICING_CONFIG,
    promotions:
      promotions?.map((promotion) => ({
        id: promotion.id,
        name: promotion.name,
        code: promotion.code,
        kind: promotion.kind,
        audience: promotion.audience,
        applyMode: promotion.apply_mode,
        value: Number(promotion.value),
        minFare: Number(promotion.min_fare),
        description: promotion.description,
        isActive: promotion.is_active,
        createdAt: promotion.created_at
      })) ?? DEFAULT_PROMOTIONS,
    auditLog:
      auditLog?.map((entry) => ({
        id: entry.id,
        actorId: entry.actor_id,
        actorRole: entry.actor_role,
        action: entry.action,
        summary: entry.summary,
        occurredAt: entry.occurred_at
      })) ?? []
  };
};

export const writeBusinessRules = async (payload: BusinessRulesSnapshot) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    await writeLocalBusinessRules(payload);
    return;
  }

  const { error: deleteConfigError } = await supabaseAdmin
    .from("business_config")
    .delete()
    .not("id", "is", null);

  if (deleteConfigError) {
    throw deleteConfigError;
  }

  const { error: configError } = await supabaseAdmin.from("business_config").insert({
    pricing: payload.pricing
  });

  if (configError) {
    throw configError;
  }

  if (payload.promotions.length > 0) {
    const { error } = await supabaseAdmin.from("promotions").upsert(
      payload.promotions.map((promotion) => ({
        id: promotion.id,
        name: promotion.name,
        code: promotion.code,
        kind: promotion.kind,
        audience: promotion.audience,
        apply_mode: promotion.applyMode,
        value: promotion.value,
        min_fare: promotion.minFare,
        description: promotion.description,
        is_active: promotion.isActive,
        created_at: promotion.createdAt
      }))
    );

    if (error) {
      throw error;
    }
  }

  if (payload.auditLog.length > 0) {
    const { error } = await supabaseAdmin.from("business_audit_log").upsert(
      payload.auditLog.map((entry) => ({
        id: entry.id,
        actor_id: entry.actorId,
        actor_role: entry.actorRole,
        action: entry.action,
        summary: entry.summary,
        occurred_at: entry.occurredAt
      }))
    );

    if (error) {
      throw error;
    }
  }
};
