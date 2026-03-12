import type { FastifyInstance } from "fastify";
import type { ZodTypeAny } from "zod";
import type {
  AdminDirectorySnapshot,
  AuthSession,
  BusinessAuditEntry,
  BusinessRulesSnapshot,
  DriverEarningsSnapshot,
  DriverProfile,
  DriverTripStatusUpdate,
  HomeBootstrap,
  OperationalZone,
  OpsDashboardSnapshot,
  PassengerProfile,
  PricingConfig,
  Promotion,
  RideEstimate,
  RideEstimateRequest,
  RidePoint,
  RideTrip,
  TripHistorySnapshot,
  TripIncident,
  TripTimelineEvent,
  TripTimelineSnapshot
} from "@diva-drive/domain";

type Role = AuthSession["user"]["role"];

export interface AuthRoutesContext {
  app: FastifyInstance;
  signInSchema: ZodTypeAny;
  signUpSchema: ZodTypeAny;
  refreshSessionSchema: ZodTypeAny;
  requireSession: (authorizationHeader?: string) => Promise<AuthSession | null>;
  ensureProfileForSession: (session: AuthSession) => Promise<void>;
  signInWithSupabase: (payload: {
    email: string;
    password: string;
    role?: Role;
  }) => Promise<AuthSession>;
  signUpWithSupabase: (payload: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
    role: Role;
  }) => Promise<AuthSession>;
  refreshSupabaseSession: (refreshToken: string) => Promise<AuthSession>;
  isSupabaseReady: boolean;
  getDriverProfile: (driverId: string) => Promise<DriverProfile | null>;
  getPassengerProfile: (passengerId: string) => Promise<PassengerProfile | null>;
  publishDirectoryRealtime: (
    reason: string,
    targets?: { userIds?: string[] },
    payload?: { driverProfile?: DriverProfile; passengerProfile?: PassengerProfile }
  ) => void;
}

export interface OpsRoutesContext {
  app: FastifyInstance;
  requireSession: (authorizationHeader?: string) => Promise<AuthSession | null>;
  requireAnyRole: (session: AuthSession | null, roles: Role[]) => AuthSession | null;
  placeSearchSchema: ZodTypeAny;
  searchablePlaces: RidePoint[];
  getOpsSnapshot: () => Promise<OpsDashboardSnapshot> | OpsDashboardSnapshot;
  hydrateBusinessState: (snapshot: BusinessRulesSnapshot) => BusinessRulesSnapshot;
  getPricingConfig: () => Promise<PricingConfig>;
  listPromotions: () => Promise<Promotion[]>;
  listBusinessAuditEntries: () => Promise<BusinessAuditEntry[]>;
  listOperationalZones: () => Promise<OperationalZone[]> | OperationalZone[];
  getCommercialMetrics: () => Promise<unknown>;
  getOpsEventStream: () => Promise<TripTimelineEvent[]>;
  listDriverProfiles: () => Promise<DriverProfile[]>;
  listPassengerProfiles: () => Promise<PassengerProfile[]>;
  hydrateDirectoryState: (snapshot: AdminDirectorySnapshot) => AdminDirectorySnapshot;
  readTrips: () => Promise<RideTrip[]>;
  hydrateTrip: (trip: RideTrip) => RideTrip;
  readIncidents: () => Promise<TripIncident[]>;
  hydrateIncident: (incident: TripIncident) => TripIncident;
  incidentStatusSchema: ZodTypeAny;
  incidentsById: Map<string, TripIncident>;
  getIncident: (incidentId: string) => Promise<TripIncident | null>;
  getTripById: (tripId: string) => Promise<RideTrip | null>;
  saveIncident: (incident: TripIncident) => Promise<TripIncident>;
  publishTripRealtime: (trip: RideTrip, reason: string) => void;
  driverApprovalSchema: ZodTypeAny;
  driverAvailabilitySchema: ZodTypeAny;
  driverProfilesById: Map<string, DriverProfile>;
  saveDriverProfile: (profile: DriverProfile) => Promise<DriverProfile>;
  publishDirectoryRealtime: (
    reason: string,
    targets?: { userIds?: string[] },
    payload?: { driverProfile?: DriverProfile; passengerProfile?: PassengerProfile }
  ) => void;
  pricingConfigSchema: ZodTypeAny;
  savePricingConfig: (config: PricingConfig) => Promise<PricingConfig>;
  setPricingConfig: (config: PricingConfig) => void;
  zoneConfigSchema: ZodTypeAny;
  setOperationalZones: (zones: OperationalZone[]) => Promise<OperationalZone[]>;
  appendBusinessAudit: (
    session: AuthSession,
    action: BusinessAuditEntry["action"],
    summary: string
  ) => BusinessAuditEntry;
  appendBusinessAuditEntry: (entry: BusinessAuditEntry) => Promise<BusinessAuditEntry>;
  publishBusinessRealtime: (
    reason: string,
    payload?: {
      pricing?: PricingConfig;
      promotion?: Promotion;
      auditEntry?: BusinessAuditEntry;
    }
  ) => void;
  getBusinessSnapshot: () => BusinessRulesSnapshot;
  promotionSchema: ZodTypeAny;
  savePromotion: (promotion: Promotion) => Promise<Promotion>;
  promotionsById: Map<string, Promotion>;
}

export interface PassengerRoutesContext {
  app: FastifyInstance;
  requireSession: (authorizationHeader?: string) => Promise<AuthSession | null>;
  requireRole: (session: AuthSession | null, role: Role) => AuthSession | null;
  getPassengerActiveTrip: (passengerId: string) => Promise<RideTrip | null>;
  getDriverActiveTrip: (driverId: string) => Promise<RideTrip | null>;
  getDriverQueue: (driverId: string) => Promise<{
    trips: RideTrip[];
    reassignedOffers: Array<{
      trip: RideTrip;
      timelineEvent: TripTimelineEvent;
    }>;
  }>;
  getDriverProfileById: (driverId: string) => Promise<DriverProfile | null>;
  getRecentOperationalNotifications: (
    session: AuthSession,
    activeTrip: RideTrip | null
  ) => Promise<unknown>;
  defaultHomeBootstrap: HomeBootstrap;
  rideEstimateSchema: ZodTypeAny;
  estimateRide: (request: RideEstimateRequest, passengerId: string) => Promise<RideEstimate>;
  resolveOperationalZone: (
    origin: RidePoint,
    destination: RidePoint
  ) => OperationalZone | null;
  createTripSchema: ZodTypeAny;
  saveTrip: (trip: RideTrip) => Promise<RideTrip>;
  tripsById: Map<string, RideTrip>;
  createTripEvent: (event: {
    tripId: string;
    type: TripTimelineEvent["type"];
    occurredAt: string;
    actorId?: string;
    actorRole?: Role;
    message: string;
  }) => Promise<TripTimelineEvent>;
  publishTripRealtime: (trip: RideTrip, reason: string) => void;
  publishTripTimelineRealtime: (
    trip: RideTrip,
    reason: string,
    timelineEvent?: TripTimelineEvent
  ) => void;
  getTripHistoryForSession: (session: AuthSession) => Promise<TripHistorySnapshot>;
  getTripById: (tripId: string) => Promise<RideTrip | null>;
  getTripTimeline: (tripId: string) => Promise<TripTimelineSnapshot>;
  incidentSchema: ZodTypeAny;
  saveIncident: (incident: TripIncident) => Promise<TripIncident>;
  incidentsById: Map<string, TripIncident>;
  cancelTripSchema: ZodTypeAny;
  patchTrip: (tripId: string, patch: Partial<RideTrip>) => RideTrip | null;
}

export interface DriverRoutesContext {
  app: FastifyInstance;
  requireSession: (authorizationHeader?: string) => Promise<AuthSession | null>;
  requireRole: (session: AuthSession | null, role: Role) => AuthSession | null;
  getDriverQueue: (driverId: string) => Promise<{
    trips: RideTrip[];
    reassignedOffers: Array<{
      trip: RideTrip;
      timelineEvent: TripTimelineEvent;
    }>;
  }>;
  getDriverActiveTrip: (driverId: string) => Promise<RideTrip | null>;
  getDriverProfileById: (driverId: string) => Promise<DriverProfile | null>;
  getOperationalZoneById: (zoneId: string) => OperationalZone | null;
  getDriverEarnings: (driverId: string) => Promise<DriverEarningsSnapshot>;
  driverAvailabilitySchema: ZodTypeAny;
  getTripById: (tripId: string) => Promise<RideTrip | null>;
  patchTrip: (tripId: string, patch: Partial<RideTrip>) => RideTrip | null;
  buildDriverEta: (status: RideTrip["status"]) => number | undefined;
  buildDriverLocation: (
    trip: RideTrip,
    status: RideTrip["status"]
  ) => RideTrip["currentDriverLocation"];
  saveTrip: (trip: RideTrip) => Promise<RideTrip>;
  tripsById: Map<string, RideTrip>;
  createTripEvent: (event: {
    tripId: string;
    type: TripTimelineEvent["type"];
    occurredAt: string;
    actorId?: string;
    actorRole?: Role;
    message: string;
  }) => Promise<TripTimelineEvent>;
  publishTripRealtime: (trip: RideTrip, reason: string) => void;
  publishTripTimelineRealtime: (
    trip: RideTrip,
    reason: string,
    timelineEvent?: TripTimelineEvent
  ) => void;
  saveDriverProfile: (profile: DriverProfile) => Promise<DriverProfile>;
  publishDirectoryRealtime: (
    reason: string,
    targets?: { userIds?: string[] },
    payload?: { driverProfile?: DriverProfile; passengerProfile?: PassengerProfile }
  ) => void;
  driverStatusSchema: ZodTypeAny;
  driverStatusFlow: DriverTripStatusUpdate["status"][];
}
