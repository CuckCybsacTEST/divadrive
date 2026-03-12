import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  DEFAULT_OPERATIONAL_ZONES,
  type AdminDirectorySnapshot,
  type BusinessAuditEntry,
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PROMOTIONS,
  DEFAULT_HOME_BOOTSTRAP,
  type DriverProfile,
  DRIVER_STATUS_FLOW,
  type InternalUserProfile,
  type OperationalZone,
  type PassengerProfile,
  type PricingConfig,
  type Promotion,
  type ActiveTripStatus,
  type AuthSession,
  type RidePoint,
  type RideTrip,
  type TripTimelineEvent,
  type TripIncident,
  USER_ROLES
} from "@diva-drive/domain";
import {
  getBusinessAuditEntryById,
  appendBusinessAuditEntry,
  getPromotionById,
  getPricingConfig,
  listBusinessAuditEntries,
  saveOperationalZones,
  listPromotions,
  readBusinessRules,
  savePricingConfig,
  savePromotion
} from "./business-store.js";
import { setLocalAuthUserStatus, signInLocalUser, signUpLocalUser } from "./dev-auth-store.js";
import { appEnv } from "./env.js";
import { isApiError } from "./errors.js";
import { registerRequestObservability } from "./observability.js";
import {
  appendEvent,
  getEventById,
  listEventsByTrip,
  listRecentEvents,
  readEvents
} from "./event-store.js";
import { getIncident, readIncidents, saveIncident } from "./incident-store.js";
import { isSupabaseAuthReady, isSupabaseReady, supabaseAdmin, supabaseAuth } from "./supabase.js";
import { createRealtimeHub } from "./realtime.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerDriverRoutes } from "./routes/driver-routes.js";
import { registerOpsRoutes } from "./routes/ops-routes.js";
import { registerPassengerRoutes } from "./routes/passenger-routes.js";
import { createBusinessRepository } from "./repositories/business-repository.js";
import { createDirectoryRepository } from "./repositories/directory-repository.js";
import { createTripRepository } from "./repositories/trip-repository.js";
import { createAuthService } from "./services/auth-service.js";
import { createBusinessService } from "./services/business-service.js";
import { createOpsService } from "./services/ops-service.js";
import { createRealtimeService } from "./services/realtime-service.js";
import { createTripService } from "./services/trip-service.js";
import { readSession, readSessionByRefreshToken, writeSession } from "./session-store.js";
import { syncLocalDataToSupabase } from "./supabase-bootstrap.js";
import {
  getTrip,
  listTripsByDriver,
  listTripsByPassenger,
  listTripsByStatus,
  readTrips,
  saveTrip
} from "./trip-store.js";
import {
  getDriverProfile,
  getInternalUserProfile,
  getPassengerProfile,
  listDriverProfiles,
  listInternalUserProfiles,
  listPassengerProfiles,
  readUsers,
  saveDriverProfile,
  saveInternalUserProfile,
  savePassengerProfile
} from "./user-store.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

registerRequestObservability(app);

app.setErrorHandler((error, _request, reply) => {
  if (isApiError(error)) {
    reply.status(error.statusCode).send({
      error: error.code
    });
    return;
  }

  app.log.error(error);
  reply.status(500).send({
    error: "internal_server_error"
  });
});

const tripsById = new Map<string, RideTrip>();
const incidentsById = new Map<string, TripIncident>();
const tripEventsById = new Map<string, TripTimelineEvent>();
const driverProfilesById = new Map<string, DriverProfile>();
const internalUserProfilesById = new Map<string, InternalUserProfile>();
const passengerProfilesById = new Map<string, PassengerProfile>();
let pricingConfig: PricingConfig = DEFAULT_PRICING_CONFIG;
let operationalZones: OperationalZone[] = DEFAULT_OPERATIONAL_ZONES;
const promotionsById = new Map<string, Promotion>();
const businessAuditLog: BusinessAuditEntry[] = [];
let isBootstrapped = false;
const isTestRuntime = process.argv.includes("--test");
let tripExpirySweepTimer: NodeJS.Timeout | null = null;

const businessRepository = createBusinessRepository({
  businessAuditLog,
  getOperationalZonesState: () => operationalZones,
  getPricingConfigState: () => pricingConfig,
  promotionsById,
  setOperationalZonesState: (nextOperationalZones) => {
    operationalZones = nextOperationalZones;
  },
  setPricingConfigState: (nextPricingConfig) => {
    pricingConfig = nextPricingConfig;
  },
  appendBusinessAuditEntry,
  saveOperationalZones,
  savePricingConfig,
  savePromotion
});

const directoryRepository = createDirectoryRepository({
  driverProfilesById,
  internalUserProfilesById,
  passengerProfilesById,
  getDriverProfile,
  getInternalUserProfile,
  getPassengerProfile,
  listDriverProfiles,
  listInternalUserProfiles,
  listPassengerProfiles,
  saveDriverProfile,
  saveInternalUserProfile,
  savePassengerProfile
});

const tripRepository = createTripRepository({
  incidentsById,
  tripEventsById,
  tripsById,
  appendEvent,
  getIncident,
  getTrip,
  listEventsByTrip,
  listRecentEvents,
  listTripsByDriver,
  listTripsByPassenger,
  listTripsByStatus,
  readIncidents,
  readTrips,
  saveIncident,
  saveTrip
});

const {
  ensureProfileForSession,
  refreshSupabaseSession,
  signInWithSupabase,
  signUpWithSupabase,
  toAuthSession
} = createAuthService({
  isSupabaseReady,
  isSupabaseAuthReady,
  supabaseAdmin,
  supabaseAuth,
  getDriverProfile: directoryRepository.getDriverProfileById,
  getInternalUserProfile: directoryRepository.getInternalUserProfileById,
  getPassengerProfile: directoryRepository.getPassengerProfileById,
  saveDriverProfile: directoryRepository.saveDriverProfile,
  saveInternalUserProfile: directoryRepository.saveInternalUserProfile,
  savePassengerProfile: directoryRepository.savePassengerProfile,
  driverProfilesById,
  internalUserProfilesById,
  passengerProfilesById,
  defaultCity: DEFAULT_HOME_BOOTSTRAP.city,
  userRoles: USER_ROLES
});

const {
  appendBusinessAudit,
  estimateRide,
  getBusinessSnapshot,
  hydrateBusinessState,
  listOperationalZones,
  resolveOperationalZone
} = createBusinessService({
  businessRepository,
  tripRepository
});

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(USER_ROLES).optional()
});

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(3),
  phone: z.string().min(9),
  role: z.enum(["passenger", "driver", "operator", "admin"])
});

const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1)
});

const ridePointSchema = z.object({
  label: z.string().min(1),
  address: z.string().min(1),
  latitude: z.number(),
  longitude: z.number()
});

const rideEstimateSchema = z.object({
  origin: ridePointSchema,
  destination: ridePointSchema,
  promoCode: z.string().min(2).optional()
});
const placeSearchSchema = z.object({
  query: z.string().min(1)
});

const createTripSchema = rideEstimateSchema.extend({
  passengerId: z.string().min(1),
  passengerName: z.string().min(1)
});
const incidentSchema = z.object({
  tripId: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  category: z.string().min(2),
  notes: z.string().min(4)
});
const cancelTripSchema = z.object({
  reason: z.string().min(3)
});

const driverStatusSchema = z.object({
  status: z.enum(DRIVER_STATUS_FLOW)
});
const incidentStatusSchema = z.object({
  status: z.enum(["open", "reviewing", "resolved"])
});
const driverApprovalSchema = z.object({
  approvalStatus: z.enum(["pending", "approved", "rejected"])
});
const driverOperationalSchema = z.object({
  operationalStatus: z.enum(["active", "blocked"]),
  reviewNotes: z.string().max(280).optional()
});

const internalUserCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(3),
  phone: z.string().min(6),
  role: z.enum(["operator", "admin"])
});

const internalUserStatusSchema = z.object({
  isActive: z.boolean()
});
const driverAvailabilitySchema = z.object({
  availabilityStatus: z.enum(["offline", "online"]),
  currentLocation: ridePointSchema.pick({
    latitude: true,
    longitude: true
  }).optional()
});
const pricingConfigSchema = z.object({
  currency: z.string().min(3),
  baseFare: z.number().nonnegative(),
  perKmRate: z.number().nonnegative(),
  perMinuteRate: z.number().nonnegative(),
  minimumFare: z.number().nonnegative(),
  serviceFee: z.number().nonnegative(),
  surgeMultiplier: z.number().min(1),
  driverPayoutRate: z.number().min(0.1).max(1)
});
const promotionSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  kind: z.enum(["flat", "percentage"]),
  audience: z.enum(["all", "new_passenger", "returning_passenger"]),
  applyMode: z.enum(["automatic", "code"]),
  value: z.number().positive(),
  minFare: z.number().nonnegative(),
  description: z.string().min(4),
  isActive: z.boolean()
});
const zoneConfigSchema = z.object({
  operationalZones: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(2),
      center: ridePointSchema.pick({
        latitude: true,
        longitude: true
      }),
      radiusKm: z.number().positive(),
      isActive: z.boolean()
    })
  ).min(1)
});

const requireSession = async (authorizationHeader?: string) => {
  const token = authorizationHeader?.replace("Bearer ", "");

  if (!token) {
    return null;
  }

  if (isSupabaseReady && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      return null;
    }

    const session = toAuthSession(data.user, {
      accessToken: token
    });

    if (session.user.role === "operator" || session.user.role === "admin") {
      const internalUserProfile = await getInternalUserProfile(session.user.id);

      if (internalUserProfile && !internalUserProfile.isActive) {
        return null;
      }
    }

    return session;
  }

  const session = await readSession(token);

  if (!session) {
    return null;
  }

  if (session.user.role === "operator" || session.user.role === "admin") {
    const internalUserProfile = await getInternalUserProfile(session.user.id);

    if (internalUserProfile && !internalUserProfile.isActive) {
      return null;
    }
  }

  return session;
};

const realtimeHub = createRealtimeHub(async (token) => requireSession(`Bearer ${token}`));

const requireRole = (
  session: AuthSession | null,
  role: AuthSession["user"]["role"]
) => {
  if (!session || session.user.role !== role) {
    return null;
  }

  return session;
};

const requireAnyRole = (
  session: AuthSession | null,
  roles: AuthSession["user"]["role"][]
) => {
  if (!session || !roles.includes(session.user.role)) {
    return null;
  }

  return session;
};

const hydrateTrip = (trip: RideTrip) => {
  tripsById.set(trip.id, trip);
  return trip;
};

const hydrateIncident = (incident: TripIncident) => {
  incidentsById.set(incident.id, incident);
  return incident;
};

const hydrateEvent = (event: TripTimelineEvent) => {
  tripEventsById.set(event.id, event);
  return event;
};

const hydrateDriverProfile = (profile: DriverProfile) => directoryRepository.cacheDriverProfile(profile);

const hydratePassengerProfile = (profile: PassengerProfile) =>
  directoryRepository.cachePassengerProfile(profile);

const hydrateInternalUserProfile = (profile: InternalUserProfile) =>
  directoryRepository.cacheInternalUserProfile(profile);

const hydratePromotion = (promotion: Promotion) => businessRepository.cachePromotion(promotion);

const hydrateBusinessAuditEntry = (entry: BusinessAuditEntry) =>
  businessRepository.cacheBusinessAuditEntry(entry);

const {
  getCommercialMetrics,
  getOpsEventStream,
  getOpsSnapshot
} = createOpsService({
  businessRepository,
  directoryRepository,
  tripRepository
});

const {
  createTripEvent,
  expireStaleRequestedTrips,
  getDriverActiveTrip,
  getDriverEarnings,
  getDriverProfileById,
  getDriverQueue,
  getPassengerActiveTrip,
  getRecentOperationalNotifications,
  getTripById,
  getTripHistoryForSession,
  getTripTimeline,
  patchTrip
} = createTripService({
  getOperationalZones: () => listOperationalZones(),
  getPricingConfig: () => pricingConfig,
  directoryRepository,
  tripRepository
});

const sweepExpiredTripsAndPublish = async () => {
  const expiredTrips = await expireStaleRequestedTrips();

  for (const expiredTrip of expiredTrips) {
    publishTripRealtime(expiredTrip.trip, "trip_expired");
    publishTripTimelineRealtime(expiredTrip.trip, "trip_expired", expiredTrip.timelineEvent);
  }
};

const {
  publishBusinessRealtime,
  publishDirectoryRealtime,
  publishTripRealtime,
  publishTripTimelineRealtime,
  supabaseRealtimeBridge
} = createRealtimeService({
  realtimeHub,
  supabase: supabaseAdmin,
  schema: appEnv.supabaseSchema,
  getTripById,
  getEventById,
  hydrateEvent,
  getDriverProfile,
  hydrateDriverProfile,
  getInternalUserProfile: directoryRepository.getInternalUserProfileById,
  hydrateInternalUserProfile,
  getPassengerProfile,
  hydratePassengerProfile,
  getPricingConfig,
  getPromotionById,
  hydratePromotion,
  getBusinessAuditEntryById,
  hydrateBusinessAuditEntry
});

const searchablePlaces: RidePoint[] = [
  ...DEFAULT_HOME_BOOTSTRAP.suggestedDestinations,
  {
    label: "Aeropuerto Jorge Chavez",
    address: "Av. Elmer Faucett s/n, Callao",
    latitude: -12.0219,
    longitude: -77.1143
  },
  {
    label: "Plaza San Miguel",
    address: "Av. La Marina 2000, San Miguel",
    latitude: -12.0789,
    longitude: -77.0821
  },
  {
    label: "Real Plaza Salaverry",
    address: "Av. Gral. Salaverry 2370, Jesus Maria",
    latitude: -12.0918,
    longitude: -77.0529
  },
  {
    label: "Barranco Centro",
    address: "Av. Pedro de Osma 102, Barranco",
    latitude: -12.1457,
    longitude: -77.0205
  }
];

const hydrateDirectoryState = (payload: AdminDirectorySnapshot) =>
  directoryRepository.hydrateSnapshot(payload);

const buildDriverLocation = (
  trip: RideTrip,
  status: ActiveTripStatus
) => {
  switch (status) {
    case "matched":
      return {
        latitude: trip.origin.latitude + 0.015,
        longitude: trip.origin.longitude - 0.012
      };
    case "driver_en_route":
      return {
        latitude: trip.origin.latitude + 0.006,
        longitude: trip.origin.longitude - 0.005
      };
    case "driver_arrived":
      return {
        latitude: trip.origin.latitude,
        longitude: trip.origin.longitude
      };
    case "trip_started":
      return {
        latitude: (trip.origin.latitude + trip.destination.latitude) / 2,
        longitude: (trip.origin.longitude + trip.destination.longitude) / 2
      };
    case "trip_completed":
      return {
        latitude: trip.destination.latitude,
        longitude: trip.destination.longitude
      };
    default:
      return undefined;
  }
};

const buildDriverEta = (status: ActiveTripStatus) => {
  switch (status) {
    case "matched":
      return 6;
    case "driver_en_route":
      return 3;
    case "driver_arrived":
      return 0;
    default:
      return undefined;
  }
};

registerOpsRoutes({
  app,
  requireSession,
  requireAnyRole,
  placeSearchSchema,
  searchablePlaces,
  getOpsSnapshot,
  hydrateBusinessState,
  getPricingConfig,
  listPromotions,
  listBusinessAuditEntries,
  listOperationalZones,
  getCommercialMetrics,
  getOpsEventStream,
  listDriverProfiles: directoryRepository.listDriverProfiles,
  listInternalUserProfiles: directoryRepository.listInternalUserProfiles,
  listPassengerProfiles: directoryRepository.listPassengerProfiles,
  hydrateDirectoryState,
  readTrips: tripRepository.listTrips,
  hydrateTrip,
  readIncidents: tripRepository.listIncidents,
  hydrateIncident,
  incidentStatusSchema,
  incidentsById,
  getIncident: tripRepository.getIncidentById,
  getTripById,
  saveIncident: tripRepository.saveIncident,
  publishTripRealtime,
  driverApprovalSchema,
  driverOperationalSchema,
  driverAvailabilitySchema,
  internalUserCreateSchema,
  internalUserStatusSchema,
  driverProfilesById,
  internalUserProfilesById,
  saveDriverProfile: directoryRepository.saveDriverProfile,
  saveInternalUserProfile: directoryRepository.saveInternalUserProfile,
  createInternalUserAccount: async (payload) => {
    if (isSupabaseReady) {
      return signUpWithSupabase(payload);
    }

    const session = await signUpLocalUser(payload);
    await writeSession(session);
    return session;
  },
  getInternalUserProfile: directoryRepository.getInternalUserProfileById,
  updateInternalUserAuthStatus: async (internalUserId, isActive) => {
    if (!isSupabaseReady) {
      await setLocalAuthUserStatus(internalUserId, isActive);
    }
  },
  publishDirectoryRealtime,
  pricingConfigSchema,
  savePricingConfig: businessRepository.savePricingConfig,
  setPricingConfig: (nextPricingConfig) => {
    pricingConfig = nextPricingConfig;
  },
  zoneConfigSchema,
  setOperationalZones: (nextOperationalZones) =>
    businessRepository.saveOperationalZones(nextOperationalZones),
  appendBusinessAudit,
  appendBusinessAuditEntry: businessRepository.appendBusinessAuditEntry,
  publishBusinessRealtime,
  getBusinessSnapshot,
  promotionSchema,
  savePromotion: businessRepository.savePromotion,
  promotionsById
});

registerAuthRoutes({
  app,
  signInSchema,
  signUpSchema,
  refreshSessionSchema,
  requireSession,
  ensureProfileForSession,
  signInWithSupabase,
  signInLocally: async (payload) => {
    const session = await signInLocalUser(payload);
    await writeSession(session);
    return session;
  },
  signUpWithSupabase,
  signUpLocally: async (payload) => {
    const session = await signUpLocalUser(payload);
    await writeSession(session);
    return session;
  },
  refreshSupabaseSession,
  refreshLocalSession: async (refreshToken) => {
    const session = await readSessionByRefreshToken(refreshToken);

    if (!session) {
      return null;
    }

    await writeSession(session);
    return session;
  },
  isSupabaseReady,
  getDriverProfile: directoryRepository.getDriverProfileById,
  getInternalUserProfile: directoryRepository.getInternalUserProfileById,
  getPassengerProfile: directoryRepository.getPassengerProfileById,
  publishDirectoryRealtime
});

registerPassengerRoutes({
  app,
  requireSession,
  requireRole,
  getPassengerActiveTrip,
  getDriverActiveTrip,
  getDriverQueue,
  getDriverProfileById,
  getRecentOperationalNotifications,
  defaultHomeBootstrap: DEFAULT_HOME_BOOTSTRAP,
  rideEstimateSchema,
  estimateRide,
  resolveOperationalZone,
  createTripSchema,
  saveTrip: tripRepository.saveTrip,
  tripsById,
  createTripEvent,
  publishTripRealtime,
  publishTripTimelineRealtime,
  getTripHistoryForSession,
  getTripById,
  getTripTimeline,
  incidentSchema,
  saveIncident: tripRepository.saveIncident,
  incidentsById,
  cancelTripSchema,
  patchTrip
});

registerDriverRoutes({
  app,
  requireSession,
  requireRole,
  getDriverQueue,
  getDriverActiveTrip,
  getDriverProfileById,
  getOperationalZoneById: (zoneId) =>
    listOperationalZones().find((zone) => zone.id === zoneId) ?? null,
  getDriverEarnings,
  driverAvailabilitySchema,
  getTripById,
  patchTrip,
  buildDriverEta,
  buildDriverLocation,
  saveTrip: tripRepository.saveTrip,
  tripsById,
  createTripEvent,
  publishTripRealtime,
  publishTripTimelineRealtime,
  saveDriverProfile: directoryRepository.saveDriverProfile,
  publishDirectoryRealtime,
  driverStatusSchema,
  driverStatusFlow: DRIVER_STATUS_FLOW
});

export const bootstrapApp = async () => {
  if (isBootstrapped) {
    return app;
  }

  if (!isTestRuntime) {
    await realtimeHub.register(app);
    supabaseRealtimeBridge.start();
    tripExpirySweepTimer = setInterval(() => {
      void sweepExpiredTripsAndPublish();
    }, 15_000);
  }
  app.addHook("onClose", async () => {
    if (tripExpirySweepTimer) {
      clearInterval(tripExpirySweepTimer);
      tripExpirySweepTimer = null;
    }
    if (!isTestRuntime) {
      await supabaseRealtimeBridge.close();
    }
    await realtimeHub.close();
  });
  await syncLocalDataToSupabase();

  tripsById.clear();
  incidentsById.clear();
  tripEventsById.clear();
  driverProfilesById.clear();
  internalUserProfilesById.clear();
  passengerProfilesById.clear();
  promotionsById.clear();
  businessAuditLog.length = 0;

  const persistedBusinessRules = await readBusinessRules().catch(() => ({
    pricing: DEFAULT_PRICING_CONFIG,
    promotions: DEFAULT_PROMOTIONS,
    operationalZones: DEFAULT_OPERATIONAL_ZONES,
    auditLog: []
  }));
  hydrateBusinessState({
    pricing: {
      ...DEFAULT_PRICING_CONFIG,
      ...(persistedBusinessRules.pricing ?? {})
    },
    promotions: persistedBusinessRules.promotions ?? DEFAULT_PROMOTIONS,
    operationalZones: persistedBusinessRules.operationalZones ?? DEFAULT_OPERATIONAL_ZONES,
    auditLog: persistedBusinessRules.auditLog ?? []
  });
  const persistedTrips = await readTrips();
  for (const trip of persistedTrips) {
    tripsById.set(trip.id, trip);
  }
  const persistedIncidents = await readIncidents();
  for (const incident of persistedIncidents) {
    incidentsById.set(incident.id, incident);
  }
  const persistedEvents = await readEvents();
  for (const event of persistedEvents) {
    tripEventsById.set(event.id, event);
  }
  hydrateDirectoryState(await readUsers());

  isBootstrapped = true;
  return app;
};

export { app };

const start = async () => {
  try {
    await bootstrapApp();
    await app.listen({
      host: "0.0.0.0",
      port: 4000
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void start();
}
