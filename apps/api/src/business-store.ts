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
const BUSINESS_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

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
  return {
    pricing: await getPricingConfig(),
    promotions: await listPromotions(),
    auditLog: await listBusinessAuditEntries()
  };
};

export const getPricingConfig = async (): Promise<BusinessRulesSnapshot["pricing"]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalBusinessRules()).pricing;
  }

  const { data, error } = await supabaseAdmin
    .from("business_config")
    .select("pricing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data?.pricing as BusinessRulesSnapshot["pricing"]) ?? DEFAULT_PRICING_CONFIG;
};

export const listPromotions = async (): Promise<BusinessRulesSnapshot["promotions"]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalBusinessRules()).promotions;
  }

  const { data, error } = await supabaseAdmin
    .from("promotions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data?.map(mapPromotionRow) ?? DEFAULT_PROMOTIONS;
};

export const listBusinessAuditEntries = async (): Promise<BusinessRulesSnapshot["auditLog"]> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalBusinessRules()).auditLog;
  }

  const { data, error } = await supabaseAdmin
    .from("business_audit_log")
    .select("*")
    .order("occurred_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data?.map(mapAuditRow) ?? [];
};

export const getPromotionById = async (
  promotionId: string
): Promise<BusinessRulesSnapshot["promotions"][number] | null> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalBusinessRules()).promotions.find((entry) => entry.id === promotionId) ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("promotions")
    .select("*")
    .eq("id", promotionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapPromotionRow(data) : null;
};

export const getBusinessAuditEntryById = async (
  entryId: string
): Promise<BusinessRulesSnapshot["auditLog"][number] | null> => {
  if (!isSupabaseReady || !supabaseAdmin) {
    return (await readLocalBusinessRules()).auditLog.find((entry) => entry.id === entryId) ?? null;
  }

  const { data, error } = await supabaseAdmin
    .from("business_audit_log")
    .select("*")
    .eq("id", entryId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapAuditRow(data) : null;
};

const mapPromotionRow = (promotion: {
  id: string;
  name: string;
  code: string;
  kind: BusinessRulesSnapshot["promotions"][number]["kind"];
  audience: BusinessRulesSnapshot["promotions"][number]["audience"];
  apply_mode: BusinessRulesSnapshot["promotions"][number]["applyMode"];
  value: number | string;
  min_fare: number | string;
  description: string;
  is_active: boolean;
  created_at: string;
}) => ({
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
});

const mapAuditRow = (entry: {
  id: string;
  actor_id: string;
  actor_role: BusinessRulesSnapshot["auditLog"][number]["actorRole"];
  action: BusinessRulesSnapshot["auditLog"][number]["action"];
  summary: string;
  occurred_at: string;
}) => ({
  id: entry.id,
  actorId: entry.actor_id,
  actorRole: entry.actor_role,
  action: entry.action,
  summary: entry.summary,
  occurredAt: entry.occurred_at
});

const mapPromotionPayload = (promotion: BusinessRulesSnapshot["promotions"][number]) => ({
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
});

const mapAuditPayload = (entry: BusinessRulesSnapshot["auditLog"][number]) => ({
  id: entry.id,
  actor_id: entry.actorId,
  actor_role: entry.actorRole,
  action: entry.action,
  summary: entry.summary,
  occurred_at: entry.occurredAt
});

export const writeBusinessRules = async (payload: BusinessRulesSnapshot) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    await writeLocalBusinessRules(payload);
    return;
  }

  await savePricingConfig(payload.pricing);

  if (payload.promotions.length > 0) {
    const { error } = await supabaseAdmin.from("promotions").upsert(
      payload.promotions.map(mapPromotionPayload)
    );

    if (error) {
      throw error;
    }
  }

  if (payload.auditLog.length > 0) {
    const { error } = await supabaseAdmin.from("business_audit_log").upsert(
      payload.auditLog.map(mapAuditPayload)
    );

    if (error) {
      throw error;
    }
  }
};

export const savePricingConfig = async (pricing: BusinessRulesSnapshot["pricing"]) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    const business = await readLocalBusinessRules();
    business.pricing = pricing;
    await writeLocalBusinessRules(business);
    return pricing;
  }

  const { data, error } = await supabaseAdmin
    .from("business_config")
    .upsert(
      {
        id: BUSINESS_CONFIG_ID,
        pricing
      },
      {
        onConflict: "id"
      }
    )
    .select("pricing")
    .single();

  if (error) {
    throw error;
  }

  return data.pricing as BusinessRulesSnapshot["pricing"];
};

export const savePromotion = async (promotion: BusinessRulesSnapshot["promotions"][number]) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    const business = await readLocalBusinessRules();
    business.promotions = business.promotions.filter((entry) => entry.id !== promotion.id);
    business.promotions.push(promotion);
    await writeLocalBusinessRules(business);
    return promotion;
  }

  const { data, error } = await supabaseAdmin
    .from("promotions")
    .upsert(mapPromotionPayload(promotion))
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapPromotionRow(data);
};

export const appendBusinessAuditEntry = async (
  entry: BusinessRulesSnapshot["auditLog"][number]
) => {
  if (!isSupabaseReady || !supabaseAdmin) {
    const business = await readLocalBusinessRules();
    business.auditLog.unshift(entry);
    await writeLocalBusinessRules(business);
    return entry;
  }

  const { data, error } = await supabaseAdmin
    .from("business_audit_log")
    .insert(mapAuditPayload(entry))
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapAuditRow(data);
};
