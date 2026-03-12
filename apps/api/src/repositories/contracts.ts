import type {
  AdminDirectorySnapshot,
  BusinessAuditEntry,
  BusinessRulesSnapshot,
  DriverProfile,
  OperationalZone,
  PassengerProfile,
  PricingConfig,
  Promotion,
  RideTrip,
  TripIncident,
  TripTimelineEvent
} from "@diva-drive/domain";

export interface TripRepository {
  appendEvent(event: TripTimelineEvent): Promise<TripTimelineEvent>;
  cacheEvent(event: TripTimelineEvent): TripTimelineEvent;
  cacheIncident(incident: TripIncident): TripIncident;
  cacheTrip(trip: RideTrip): RideTrip;
  getIncidentById(incidentId: string): Promise<TripIncident | null>;
  getTripById(tripId: string): Promise<RideTrip | null>;
  listEventsByTrip(tripId: string): Promise<TripTimelineEvent[]>;
  listIncidents(): Promise<TripIncident[]>;
  listRecentEvents(limit: number): Promise<TripTimelineEvent[]>;
  listTrips(): Promise<RideTrip[]>;
  listTripsByDriver(driverId: string): Promise<RideTrip[]>;
  listTripsByPassenger(passengerId: string): Promise<RideTrip[]>;
  listTripsByStatus(status: RideTrip["status"]): Promise<RideTrip[]>;
  patchCachedTrip(tripId: string, patch: Partial<RideTrip>): RideTrip | null;
  saveIncident(incident: TripIncident): Promise<TripIncident>;
  saveTrip(trip: RideTrip): Promise<RideTrip>;
}

export interface DirectoryRepository {
  cacheDriverProfile(profile: DriverProfile): DriverProfile;
  cachePassengerProfile(profile: PassengerProfile): PassengerProfile;
  getDriverProfileById(driverId: string): Promise<DriverProfile | null>;
  getPassengerProfileById(passengerId: string): Promise<PassengerProfile | null>;
  hydrateSnapshot(payload: AdminDirectorySnapshot): AdminDirectorySnapshot;
  listDriverProfiles(): Promise<DriverProfile[]>;
  listPassengerProfiles(): Promise<PassengerProfile[]>;
  saveDriverProfile(profile: DriverProfile): Promise<DriverProfile>;
  savePassengerProfile(profile: PassengerProfile): Promise<PassengerProfile>;
}

export interface BusinessRepository {
  appendBusinessAuditEntry(entry: BusinessAuditEntry): Promise<BusinessAuditEntry>;
  cacheBusinessAuditEntry(entry: BusinessAuditEntry): BusinessAuditEntry;
  cacheOperationalZones(zones: OperationalZone[]): OperationalZone[];
  cachePricingConfig(config: PricingConfig): PricingConfig;
  cachePromotion(promotion: Promotion): Promotion;
  getOperationalZones(): OperationalZone[];
  getPricingConfig(): PricingConfig;
  getSnapshot(): BusinessRulesSnapshot;
  hydrateSnapshot(snapshot: BusinessRulesSnapshot): BusinessRulesSnapshot;
  listBusinessAuditEntries(): BusinessAuditEntry[];
  listOperationalZones(): OperationalZone[];
  listPromotions(): Promotion[];
  saveOperationalZones(zones: OperationalZone[]): Promise<OperationalZone[]>;
  savePricingConfig(config: PricingConfig): Promise<PricingConfig>;
  savePromotion(promotion: Promotion): Promise<Promotion>;
}

export type TripWriteRepository = Pick<TripRepository, "saveIncident" | "saveTrip">;
export type DirectoryWriteRepository = Pick<
  DirectoryRepository,
  "saveDriverProfile" | "savePassengerProfile"
>;
export type BusinessWriteRepository = Pick<
  BusinessRepository,
  "appendBusinessAuditEntry" | "savePricingConfig" | "savePromotion"
>;
