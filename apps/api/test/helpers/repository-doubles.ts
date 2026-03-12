import type {
  BusinessAuditEntry,
  DriverProfile,
  OperationalZone,
  PassengerProfile,
  PricingConfig,
  Promotion,
  RideTrip,
  TripIncident
} from "@diva-drive/domain";
import type {
  BusinessRepository,
  DirectoryRepository,
  TripRepository
} from "../../src/repositories/contracts.js";

export const createTripRepositoryDouble = (
  overrides: Partial<TripRepository> = {}
): TripRepository => ({
  appendEvent: async (event) => event,
  cacheEvent: (event) => event,
  cacheIncident: (incident) => incident,
  cacheTrip: (trip) => trip,
  getIncidentById: async () => null,
  getTripById: async () => null,
  listEventsByTrip: async () => [],
  listIncidents: async () => [],
  listRecentEvents: async () => [],
  listTrips: async () => [],
  listTripsByDriver: async () => [],
  listTripsByPassenger: async () => [],
  listTripsByStatus: async () => [],
  patchCachedTrip: () => null,
  saveIncident: async (incident: TripIncident) => incident,
  saveTrip: async (trip: RideTrip) => trip,
  ...overrides
});

export const createDirectoryRepositoryDouble = (
  overrides: Partial<DirectoryRepository> = {}
): DirectoryRepository => ({
  cacheDriverProfile: (profile: DriverProfile) => profile,
  cachePassengerProfile: (profile: PassengerProfile) => profile,
  getDriverProfileById: async () => null,
  getPassengerProfileById: async () => null,
  hydrateSnapshot: (snapshot) => snapshot,
  listDriverProfiles: async () => [],
  listPassengerProfiles: async () => [],
  saveDriverProfile: async (profile: DriverProfile) => profile,
  savePassengerProfile: async (profile: PassengerProfile) => profile,
  ...overrides
});

export const createBusinessRepositoryDouble = (
  pricing: PricingConfig,
  overrides: Partial<BusinessRepository> = {}
): BusinessRepository => {
  let currentPricing = pricing;
  let operationalZones: OperationalZone[] = [];
  const promotions: Promotion[] = [];
  const auditLog: BusinessAuditEntry[] = [];

  return {
    appendBusinessAuditEntry: async (entry) => entry,
    cacheBusinessAuditEntry: (entry) => {
      auditLog.unshift(entry);
      return entry;
    },
    cacheOperationalZones: (zones) => {
      operationalZones = [...zones];
      return zones;
    },
    cachePricingConfig: (config) => {
      currentPricing = config;
      return config;
    },
    cachePromotion: (promotion) => {
      promotions.push(promotion);
      return promotion;
    },
    getOperationalZones: () => [...operationalZones],
    getPricingConfig: () => currentPricing,
    getSnapshot: () => ({
      pricing: currentPricing,
      operationalZones: [...operationalZones],
      promotions: [...promotions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      auditLog: [...auditLog].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    }),
    hydrateSnapshot: (snapshot) => {
      currentPricing = snapshot.pricing;
      operationalZones = [...snapshot.operationalZones];
      promotions.length = 0;
      promotions.push(...snapshot.promotions);
      auditLog.length = 0;
      auditLog.push(...snapshot.auditLog);
      return snapshot;
    },
    listBusinessAuditEntries: () =>
      [...auditLog].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    listOperationalZones: () => [...operationalZones],
    listPromotions: () => [...promotions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    saveOperationalZones: async (zones) => zones,
    savePricingConfig: async (config) => config,
    savePromotion: async (promotion) => promotion,
    ...overrides
  };
};
