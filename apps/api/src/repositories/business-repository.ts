import type {
  BusinessAuditEntry,
  BusinessRulesSnapshot,
  OperationalZone,
  PricingConfig,
  Promotion
} from "@diva-drive/domain";
import { mapPersistenceError } from "../errors.js";
import type { BusinessRepository, BusinessWriteRepository } from "./contracts.js";

interface BusinessRepositoryDependencies {
  businessAuditLog: BusinessAuditEntry[];
  getOperationalZonesState: () => OperationalZone[];
  getPricingConfigState: () => PricingConfig;
  promotionsById: Map<string, Promotion>;
  setOperationalZonesState: (zones: OperationalZone[]) => void;
  setPricingConfigState: (pricingConfig: PricingConfig) => void;
  appendBusinessAuditEntry: (entry: BusinessAuditEntry) => Promise<BusinessAuditEntry>;
  saveOperationalZones: (zones: OperationalZone[]) => Promise<OperationalZone[]>;
  savePricingConfig: (config: PricingConfig) => Promise<PricingConfig>;
  savePromotion: (promotion: Promotion) => Promise<Promotion>;
}

export const createBusinessRepository = ({
  businessAuditLog,
  getOperationalZonesState,
  getPricingConfigState,
  promotionsById,
  setOperationalZonesState,
  setPricingConfigState,
  appendBusinessAuditEntry,
  saveOperationalZones,
  savePricingConfig,
  savePromotion
}: BusinessRepositoryDependencies): BusinessRepository => {
  const cacheOperationalZones = (zones: OperationalZone[]) => {
    const nextZones = zones.map((zone) => ({
      ...zone,
      center: { ...zone.center }
    }));
    setOperationalZonesState(nextZones);
    return nextZones;
  };

  const cachePricingConfig = (config: PricingConfig) => {
    setPricingConfigState(config);
    return config;
  };

  const cachePromotion = (promotion: Promotion) => {
    promotionsById.set(promotion.id, promotion);
    return promotion;
  };

  const cacheBusinessAuditEntry = (entry: BusinessAuditEntry) => {
    const existingIndex = businessAuditLog.findIndex((current) => current.id === entry.id);
    if (existingIndex >= 0) {
      businessAuditLog.splice(existingIndex, 1);
    }
    businessAuditLog.unshift(entry);
    return entry;
  };

  const listPromotions = () =>
    Array.from(promotionsById.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const listBusinessAuditEntries = () =>
    [...businessAuditLog].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const getSnapshot = (): BusinessRulesSnapshot => ({
    pricing: getPricingConfigState(),
    operationalZones: getOperationalZonesState(),
    promotions: listPromotions(),
    auditLog: listBusinessAuditEntries()
  });

  return {
    async appendBusinessAuditEntry(entry) {
      try {
        return cacheBusinessAuditEntry(await appendBusinessAuditEntry(entry));
      } catch (error) {
        return mapPersistenceError(error, {
          conflictCode: "business_audit_persistence_failed",
          fallbackCode: "business_audit_persistence_failed"
        });
      }
    },

    cacheBusinessAuditEntry,
    cacheOperationalZones,
    cachePricingConfig,
    cachePromotion,

    getOperationalZones() {
      return getOperationalZonesState();
    },

    getPricingConfig() {
      return getPricingConfigState();
    },

    getSnapshot,

    hydrateSnapshot(snapshot) {
      cachePricingConfig(snapshot.pricing);
      cacheOperationalZones(snapshot.operationalZones);
      promotionsById.clear();
      for (const promotion of snapshot.promotions) {
        cachePromotion(promotion);
      }
      businessAuditLog.length = 0;
      for (const entry of snapshot.auditLog) {
        cacheBusinessAuditEntry(entry);
      }
      return getSnapshot();
    },

    listBusinessAuditEntries,
    listOperationalZones() {
      return getOperationalZonesState();
    },
    listPromotions,

    async saveOperationalZones(zones) {
      try {
        return cacheOperationalZones(await saveOperationalZones(zones));
      } catch (error) {
        return mapPersistenceError(error, {
          conflictCode: "internal_server_error",
          fallbackCode: "internal_server_error"
        });
      }
    },

    async savePricingConfig(config) {
      try {
        return cachePricingConfig(await savePricingConfig(config));
      } catch (error) {
        return mapPersistenceError(error, {
          conflictCode: "pricing_persistence_failed",
          fallbackCode: "pricing_persistence_failed"
        });
      }
    },

    async savePromotion(promotion) {
      try {
        return cachePromotion(await savePromotion(promotion));
      } catch (error) {
        return mapPersistenceError(error, {
          conflictCode: "promotion_code_conflict",
          fallbackCode: "promotion_persistence_failed"
        });
      }
    }
  };
};

export const createBusinessWriteRepository = (
  dependencies: BusinessRepositoryDependencies
): BusinessWriteRepository => createBusinessRepository(dependencies);
