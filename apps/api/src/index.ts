import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type BusinessRulesSnapshot,
  type AdminDirectorySnapshot,
  type BusinessAuditEntry,
  DEFAULT_PRICING_CONFIG,
  DEFAULT_PROMOTIONS,
  type CancelTripPayload,
  type CreateIncidentPayload,
  DEFAULT_HOME_BOOTSTRAP,
  type DriverApprovalUpdate,
  type DriverProfile,
  DRIVER_STATUS_FLOW,
  type IncidentStatusUpdate,
  type OperationalNotification,
  type OpsDashboardSnapshot,
  type PlaceSearchResult,
  type CommercialMetricsSnapshot,
  type PassengerProfile,
  type PricingConfig,
  type PricingConfigUpdate,
  type Promotion,
  type PromotionUpsertPayload,
  type RealtimeEnvelope,
  SERVICE_NAME,
  type ActiveTripStatus,
  type AuthSession,
  type DriverTripStatusUpdate,
  type RideEstimate,
  type RideEstimateRequest,
  type RidePoint,
  type RideTrip,
  type TripTimelineEvent,
  type TripTimelineSnapshot,
  type TripHistorySnapshot,
  type TripIncident,
  USER_ROLES,
  TRIP_EVENT_TYPES,
  TRIP_STATUSES
} from "@diva-drive/domain";
import {
  getBusinessAuditEntryById,
  appendBusinessAuditEntry,
  getPromotionById,
  getPricingConfig,
  listBusinessAuditEntries,
  listPromotions,
  readBusinessRules,
  savePricingConfig,
  savePromotion
} from "./business-store.js";
import { appEnv } from "./env.js";
import {
  appendEvent,
  getEventById,
  listEventsByTrip,
  listRecentEvents,
  readEvents
} from "./event-store.js";
import { getIncident, readIncidents, saveIncident } from "./incident-store.js";
import { isSupabaseAuthReady, isSupabaseReady, supabaseAdmin, supabaseAuth } from "./supabase.js";
import { createRealtimeHub, createSupabaseRealtimeBridge } from "./realtime.js";
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
  getPassengerProfile,
  listDriverProfiles,
  listPassengerProfiles,
  readUsers,
  saveDriverProfile,
  savePassengerProfile
} from "./user-store.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

const tripsById = new Map<string, RideTrip>();
const incidentsById = new Map<string, TripIncident>();
const tripEventsById = new Map<string, TripTimelineEvent>();
const driverProfilesById = new Map<string, DriverProfile>();
const passengerProfilesById = new Map<string, PassengerProfile>();
let pricingConfig: PricingConfig = DEFAULT_PRICING_CONFIG;
const promotionsById = new Map<string, Promotion>();
const businessAuditLog: BusinessAuditEntry[] = [];
let isBootstrapped = false;
const isTestRuntime = process.argv.includes("--test");

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
const pricingConfigSchema = z.object({
  currency: z.string().min(3),
  baseFare: z.number().nonnegative(),
  perKmRate: z.number().nonnegative(),
  perMinuteRate: z.number().nonnegative(),
  minimumFare: z.number().nonnegative(),
  serviceFee: z.number().nonnegative(),
  surgeMultiplier: z.number().min(1)
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

    return toAuthSession(data.user, {
      accessToken: token
    });
  }

  return null;
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

const getTripAudience = (trip: Pick<RideTrip, "passengerId" | "driverId">) =>
  [trip.passengerId, trip.driverId].filter(Boolean) as string[];

type RealtimePublishEvent = Omit<RealtimeEnvelope, "id" | "occurredAt"> & {
  trip?: RideTrip;
  timelineEvent?: TripTimelineEvent;
  notification?: OperationalNotification;
  driverProfile?: DriverProfile;
  passengerProfile?: PassengerProfile;
  pricing?: PricingConfig;
  promotion?: Promotion;
  auditEntry?: BusinessAuditEntry;
};

const realtimeDedupWindowMs = 2500;
const recentRealtimePublications = new Map<string, number>();

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const getRealtimeDedupKey = (
  event: RealtimePublishEvent,
  targets: {
    ops?: boolean;
    userIds?: ("passenger" | "driver" | "operator" | "admin" | string)[];
    roles?: ("passenger" | "driver" | "operator" | "admin")[];
  }
) =>
  stableSerialize({
    event,
    targets: {
      ops: targets.ops ?? false,
      userIds: [...(targets.userIds ?? [])].sort(),
      roles: [...(targets.roles ?? [])].sort()
    }
  });

const shouldSkipRealtimePublish = (
  event: RealtimePublishEvent,
  targets: {
    ops?: boolean;
    userIds?: ("passenger" | "driver" | "operator" | "admin" | string)[];
    roles?: ("passenger" | "driver" | "operator" | "admin")[];
  }
) => {
  const now = Date.now();

  for (const [key, timestamp] of recentRealtimePublications.entries()) {
    if (now - timestamp > realtimeDedupWindowMs) {
      recentRealtimePublications.delete(key);
    }
  }

  const dedupKey = getRealtimeDedupKey(event, targets);
  const lastPublishedAt = recentRealtimePublications.get(dedupKey);

  if (lastPublishedAt && now - lastPublishedAt <= realtimeDedupWindowMs) {
    return true;
  }

  recentRealtimePublications.set(dedupKey, now);
  return false;
};

const publishRealtime = (
  event: RealtimePublishEvent,
  targets: {
    ops?: boolean;
    userIds?: string[];
    roles?: ("passenger" | "driver" | "operator" | "admin")[];
  }
) => {
  if (shouldSkipRealtimePublish(event, targets)) {
    return;
  }

  realtimeHub.publish(event, targets);
};

const publishTripRealtime = (trip: RideTrip, reason: string) => {
  const userIds = getTripAudience(trip);

  publishRealtime(
    { type: "trip.active.refresh", tripId: trip.id, reason, trip },
    { userIds, ops: true }
  );
  publishRealtime(
    { type: "trip.history.refresh", tripId: trip.id, reason, trip },
    { userIds }
  );
  publishRealtime(
    { type: "notifications.refresh", tripId: trip.id, reason, trip },
    { userIds }
  );
  publishRealtime(
    { type: "ops.snapshot.refresh", tripId: trip.id, reason, trip },
    { ops: true }
  );
  publishRealtime({ type: "commercial.refresh", tripId: trip.id, reason }, { ops: true });
  publishRealtime(
    { type: "trip.queue.refresh", tripId: trip.id, reason, trip },
    { roles: ["driver"] }
  );
};

const toNotificationFromEvent = (event: TripTimelineEvent): OperationalNotification => ({
  id: event.id,
  level:
    event.type === "incident_created"
      ? "warning"
      : event.type === "trip_completed"
        ? "success"
        : "info",
  message: event.message,
  createdAt: event.occurredAt
});

const publishTripTimelineRealtime = (
  trip: RideTrip,
  reason: string,
  timelineEvent?: TripTimelineEvent
) => {
  const userIds = getTripAudience(trip);

  publishRealtime(
    { type: "trip.timeline.refresh", tripId: trip.id, reason, timelineEvent },
    { userIds }
  );
  publishRealtime(
    { type: "ops.events.refresh", tripId: trip.id, reason, timelineEvent },
    { ops: true }
  );
  publishRealtime({ type: "notifications.refresh", tripId: trip.id, reason }, { userIds });
  if (timelineEvent) {
    publishRealtime(
      {
        type: "notifications.refresh",
        tripId: trip.id,
        reason,
        notification: toNotificationFromEvent(timelineEvent),
        trip
      },
      { userIds }
    );
  }
};

const publishTripRealtimeByAudience = (payload: {
  passengerId?: string;
  driverId?: string;
  tripId?: string;
  reason: string;
  trip?: RideTrip;
}) => {
  const userIds = [payload.passengerId, payload.driverId].filter(Boolean) as string[];

  publishRealtime(
    {
      type: "trip.active.refresh",
      tripId: payload.tripId,
      reason: payload.reason,
      trip: payload.trip
    },
    { userIds, ops: true }
  );
  publishRealtime(
    {
      type: "trip.history.refresh",
      tripId: payload.tripId,
      reason: payload.reason,
      trip: payload.trip
    },
    { userIds }
  );
  publishRealtime(
    {
      type: "notifications.refresh",
      tripId: payload.tripId,
      reason: payload.reason,
      trip: payload.trip
    },
    { userIds }
  );
  publishRealtime(
    {
      type: "ops.snapshot.refresh",
      tripId: payload.tripId,
      reason: payload.reason,
      trip: payload.trip
    },
    { ops: true }
  );
  publishRealtime(
    { type: "commercial.refresh", tripId: payload.tripId, reason: payload.reason },
    { ops: true }
  );
  publishRealtime(
    {
      type: "trip.queue.refresh",
      tripId: payload.tripId,
      reason: payload.reason,
      trip: payload.trip
    },
    { roles: ["driver"] }
  );
};

const publishTripTimelineRealtimeByAudience = (payload: {
  passengerId?: string;
  driverId?: string;
  tripId?: string;
  reason: string;
  timelineEvent?: TripTimelineEvent;
  trip?: RideTrip;
}) => {
  const userIds = [payload.passengerId, payload.driverId].filter(Boolean) as string[];

  publishRealtime(
    {
      type: "trip.timeline.refresh",
      tripId: payload.tripId,
      reason: payload.reason,
      timelineEvent: payload.timelineEvent
    },
    { userIds }
  );
  publishRealtime(
    {
      type: "ops.events.refresh",
      tripId: payload.tripId,
      reason: payload.reason,
      timelineEvent: payload.timelineEvent
    },
    { ops: true }
  );
  publishRealtime(
    {
      type: "notifications.refresh",
      tripId: payload.tripId,
      reason: payload.reason,
      trip: payload.trip,
      notification: payload.timelineEvent
        ? toNotificationFromEvent(payload.timelineEvent)
        : undefined
    },
    { userIds }
  );
};

const publishDirectoryRealtime = (
  reason: string,
  targets?: { userIds?: string[] },
  payload?: { driverProfile?: DriverProfile; passengerProfile?: PassengerProfile }
) => {
  publishRealtime({ type: "ops.directory.refresh", reason, ...payload }, { ops: true });

  if (targets?.userIds?.length) {
    publishRealtime(
      { type: "driver.profile.refresh", reason, ...payload },
      { userIds: targets.userIds }
    );
  }
};

const publishBusinessRealtime = (
  reason: string,
  payload?: {
    pricing?: PricingConfig;
    promotion?: Promotion;
    auditEntry?: BusinessAuditEntry;
  }
) => {
  publishRealtime({ type: "business.refresh", reason, ...payload }, { ops: true });
  publishRealtime({ type: "commercial.refresh", reason }, { ops: true });
  publishRealtime({ type: "ops.events.refresh", reason, auditEntry: payload?.auditEntry }, { ops: true });
};

const supabaseRealtimeBridge = createSupabaseRealtimeBridge({
  supabase: supabaseAdmin,
  schema: appEnv.supabaseSchema,
  onTripChanged: (payload) => {
    publishTripRealtimeByAudience(payload);
  },
  onTripTimelineChanged: (payload) => {
    publishTripTimelineRealtimeByAudience(payload);
  },
  onDirectoryChanged: ({ userId, reason, driverProfile, passengerProfile }) => {
    publishDirectoryRealtime(
      reason,
      userId ? { userIds: [userId] } : undefined,
      {
        driverProfile,
        passengerProfile
      }
    );
  },
  onBusinessChanged: ({ reason, pricing, promotion, auditEntry }) => {
    publishBusinessRealtime(reason, {
      pricing,
      promotion,
      auditEntry
    });
  },
  resolveTripAudience: async (tripId) => {
    const trip = await getTripById(tripId);

    if (!trip) {
      return null;
    }

    return {
      passengerId: trip.passengerId,
      driverId: trip.driverId,
      tripId: trip.id
    };
  },
  resolveTrip: async (tripId) => getTripById(tripId),
  resolveTimelineEvent: async (eventId) => {
    const event = await getEventById(eventId);
    return event ? hydrateEvent(event) : null;
  },
  resolveDriverProfile: async (driverId) => {
    const profile = await getDriverProfile(driverId);
    return profile ? hydrateDriverProfile(profile) : null;
  },
  resolvePassengerProfile: async (passengerId) => {
    const profile = await getPassengerProfile(passengerId);
    return profile ? hydratePassengerProfile(profile) : null;
  },
  resolvePricing: async () => getPricingConfig(),
  resolvePromotion: async (promotionId) => {
    const promotion = await getPromotionById(promotionId);
    return promotion ? hydratePromotion(promotion) : null;
  },
  resolveBusinessAuditEntry: async (entryId) => {
    const entry = await getBusinessAuditEntryById(entryId);
    return entry ? hydrateBusinessAuditEntry(entry) : null;
  }
});

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

const hydrateDriverProfile = (profile: DriverProfile) => {
  driverProfilesById.set(profile.id, profile);
  return profile;
};

const hydratePassengerProfile = (profile: PassengerProfile) => {
  passengerProfilesById.set(profile.id, profile);
  return profile;
};

const hydratePromotion = (promotion: Promotion) => {
  promotionsById.set(promotion.id, promotion);
  return promotion;
};

const hydrateBusinessAuditEntry = (entry: BusinessAuditEntry) => {
  const existingIndex = businessAuditLog.findIndex((current) => current.id === entry.id);
  if (existingIndex >= 0) {
    businessAuditLog.splice(existingIndex, 1);
  }
  businessAuditLog.unshift(entry);
  return entry;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

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

const getBusinessSnapshot = (): BusinessRulesSnapshot => ({
  pricing: pricingConfig,
  promotions: Array.from(promotionsById.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  ),
  auditLog: [...businessAuditLog].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
});

const hydrateBusinessState = (snapshot: BusinessRulesSnapshot) => {
  pricingConfig = snapshot.pricing;
  promotionsById.clear();
  for (const promotion of snapshot.promotions) {
    promotionsById.set(promotion.id, promotion);
  }
  businessAuditLog.length = 0;
  businessAuditLog.push(...snapshot.auditLog);
  return getBusinessSnapshot();
};

const hydrateDirectoryState = (payload: AdminDirectorySnapshot) => {
  driverProfilesById.clear();
  passengerProfilesById.clear();
  for (const driver of payload.drivers) {
    driverProfilesById.set(driver.id, driver);
  }
  for (const passenger of payload.passengers) {
    passengerProfilesById.set(passenger.id, passenger);
  }
  return {
    drivers: [...payload.drivers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    passengers: [...payload.passengers].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  };
};

const appendBusinessAudit = (
  session: AuthSession,
  action: BusinessAuditEntry["action"],
  summary: string
) => {
  const entry = {
    id: `biz-${Date.now()}-${businessAuditLog.length + 1}`,
    actorId: session.user.id,
    actorRole: session.user.role as BusinessAuditEntry["actorRole"],
    action,
    summary,
    occurredAt: new Date().toISOString()
  };
  businessAuditLog.unshift(entry);
  return entry;
};

const isPassengerNew = async (passengerId: string) => {
  const trips = await listTripsByPassenger(passengerId);
  return !trips.some((trip) => trip.passengerId === passengerId);
};

const buildAppliedPromotion = async (
  fareBeforeDiscount: number,
  passengerId: string,
  requestedPromoCode?: string
) => {
  const normalizedCode = requestedPromoCode?.trim().toUpperCase();
  const audience = (await isPassengerNew(passengerId))
    ? "new_passenger"
    : "returning_passenger";
  const eligiblePromotions = Array.from(promotionsById.values()).filter((promotion) => {
    if (!promotion.isActive || fareBeforeDiscount < promotion.minFare) {
      return false;
    }

    if (promotion.audience !== "all" && promotion.audience !== audience) {
      return false;
    }

    if (promotion.applyMode === "code") {
      return normalizedCode === promotion.code;
    }

    return !normalizedCode || normalizedCode === promotion.code;
  });

  if (eligiblePromotions.length === 0) {
    return null;
  }

  const candidates = eligiblePromotions
    .map((promotion) => {
      const rawDiscount =
        promotion.kind === "flat"
          ? promotion.value
          : (fareBeforeDiscount * promotion.value) / 100;
      const discountAmount = Number(Math.min(rawDiscount, fareBeforeDiscount).toFixed(2));

      return {
        promotionId: promotion.id,
        name: promotion.name,
        code: promotion.code,
        discountAmount
      };
    })
    .sort((a, b) => b.discountAmount - a.discountAmount);

  return candidates[0] ?? null;
};

const estimateRide = async (
  { origin, destination, promoCode }: RideEstimateRequest,
  passengerId: string
): Promise<RideEstimate> => {
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(destination.latitude - origin.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);
  const latitudeA = toRadians(origin.latitude);
  const latitudeB = toRadians(destination.latitude);

  const haversine =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);

  const distanceKm = Number(
    (earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))).toFixed(1)
  );
  const trafficFactor =
    Math.abs(destination.longitude - origin.longitude) > 0.04 ? 1.22 : 1.08;
  const durationMinutes = Math.max(8, Math.round(distanceKm * 3.4 * trafficFactor));
  const subtotal = Math.max(
    pricingConfig.minimumFare,
    Number(
      (
        (pricingConfig.baseFare +
          distanceKm * pricingConfig.perKmRate +
          durationMinutes * pricingConfig.perMinuteRate) *
        pricingConfig.surgeMultiplier
      ).toFixed(2)
    )
  );
  const serviceFee = Number(pricingConfig.serviceFee.toFixed(2));
  const fareBeforeDiscount = Number((subtotal + serviceFee).toFixed(2));
  const appliedPromotion = await buildAppliedPromotion(
    fareBeforeDiscount,
    passengerId,
    promoCode
  );
  const discountAmount = Number((appliedPromotion?.discountAmount ?? 0).toFixed(2));
  const estimatedFare = Number(Math.max(fareBeforeDiscount - discountAmount, 0).toFixed(2));
  const routePoints = Array.from({ length: 6 }, (_, index) => {
    const progress = index / 5;
    const arc = Math.sin(progress * Math.PI) * 0.006;
    return {
      latitude:
        origin.latitude + (destination.latitude - origin.latitude) * progress + arc / 2,
      longitude:
        origin.longitude + (destination.longitude - origin.longitude) * progress - arc
    };
  });

  return {
    currency: pricingConfig.currency,
    distanceKm,
    durationMinutes,
    estimatedFare,
    fareBreakdown: {
      subtotal,
      serviceFee,
      discountAmount,
      total: estimatedFare
    },
    appliedPromotion,
    route: {
      points: routePoints
    }
  };
};

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

const inferUserRole = (user: User): AuthSession["user"]["role"] => {
  const roleCandidate = user.app_metadata?.role ?? user.user_metadata?.role;
  return USER_ROLES.includes(roleCandidate) ? roleCandidate : "passenger";
};

const toAuthSession = (
  user: User,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number | null;
  }
): AuthSession => ({
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken ?? "",
  expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt * 1000).toISOString() : null,
  user: {
    id: user.id,
    role: inferUserRole(user),
    fullName:
      user.user_metadata?.full_name ??
      user.user_metadata?.fullName ??
      user.email?.split("@")[0] ??
      "Cuenta DIVA",
    phone: user.user_metadata?.phone ?? user.phone ?? "",
    email: user.email ?? ""
  }
});

const signInWithSupabase = async (payload: z.infer<typeof signInSchema>): Promise<AuthSession> => {
  if (!isSupabaseAuthReady || !supabaseAuth) {
    throw new Error("supabase_auth_not_ready");
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: payload.email,
    password: payload.password
  });

  if (error || !data.session || !data.user) {
    throw error ?? new Error("invalid_auth_credentials");
  }

  const session = toAuthSession(data.user, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at ?? null
  });

  if (payload.role && session.user.role !== payload.role) {
    throw new Error("role_mismatch");
  }

  return session;
};

const signUpWithSupabase = async (payload: z.infer<typeof signUpSchema>): Promise<AuthSession> => {
  if (!isSupabaseReady || !supabaseAdmin || !isSupabaseAuthReady || !supabaseAuth) {
    throw new Error("supabase_auth_not_ready");
  }

  const { data: createdUserData, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
    email: payload.email,
    password: payload.password,
    email_confirm: true,
    user_metadata: {
      full_name: payload.fullName,
      phone: payload.phone,
      role: payload.role
    },
    app_metadata: {
      role: payload.role
    }
  });

  if (createUserError || !createdUserData.user) {
    throw createUserError ?? new Error("sign_up_failed");
  }

  return signInWithSupabase({
    email: payload.email,
    password: payload.password,
    role: payload.role
  });
};

const refreshSupabaseSession = async (refreshToken: string): Promise<AuthSession> => {
  if (!isSupabaseAuthReady || !supabaseAuth) {
    throw new Error("supabase_auth_not_ready");
  }

  const { data, error } = await supabaseAuth.auth.refreshSession({
    refresh_token: refreshToken
  });

  if (error || !data.session || !data.user) {
    throw error ?? new Error("session_refresh_failed");
  }

  return toAuthSession(data.user, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at ?? null
  });
};

const ensureProfileForSession = async (session: AuthSession) => {
  if (session.user.role === "driver" && !(await getDriverProfile(session.user.id))) {
    const profile: DriverProfile = {
      id: session.user.id,
      fullName: session.user.fullName,
      phone: session.user.phone,
      city: DEFAULT_HOME_BOOTSTRAP.city,
      approvalStatus: "pending",
      documentsSubmitted: true,
      licenseNumber: `LIC-${session.user.id.slice(-4)}`,
      vehicleDescription: "Sedan blanco - onboarding inicial",
      createdAt: new Date().toISOString()
    };
    driverProfilesById.set(profile.id, profile);
    await saveDriverProfile(profile);
  }

  if (session.user.role === "passenger" && !(await getPassengerProfile(session.user.id))) {
    const profile: PassengerProfile = {
      id: session.user.id,
      fullName: session.user.fullName,
      phone: session.user.phone,
      city: DEFAULT_HOME_BOOTSTRAP.city,
      createdAt: new Date().toISOString()
    };
    passengerProfilesById.set(profile.id, profile);
    await savePassengerProfile(profile);
  }
};

const getPassengerActiveTrip = async (passengerId: string) => {
  const trips = (await listTripsByPassenger(passengerId)).filter(
    (trip) =>
      trip.passengerId === passengerId &&
      trip.status !== "trip_completed" &&
      trip.status !== "cancelled"
  );

  return trips.at(-1) ? hydrateTrip(trips.at(-1) as RideTrip) : null;
};

const getDriverActiveTrip = async (driverId: string) => {
  const trip =
    (await listTripsByDriver(driverId)).find(
      (trip) =>
        trip.driverId === driverId &&
        trip.status !== "trip_completed" &&
        trip.status !== "cancelled"
    ) ?? null;

  return trip ? hydrateTrip(trip) : null;
};

const getDriverQueue = async () => {
  return (await listTripsByStatus("requested")).map(hydrateTrip);
};

const getTripById = async (tripId: string) => {
  const cachedTrip = tripsById.get(tripId);

  if (cachedTrip) {
    return cachedTrip;
  }

  const trip = await getTrip(tripId);
  return trip ? hydrateTrip(trip) : null;
};

const getDriverProfileById = async (driverId: string) => {
  const cachedProfile = driverProfilesById.get(driverId);

  if (cachedProfile) {
    return cachedProfile;
  }

  const profile = await getDriverProfile(driverId);

  if (profile) {
    driverProfilesById.set(profile.id, profile);
  }

  return profile;
};

const patchTrip = (tripId: string, patch: Partial<RideTrip>) => {
  const currentTrip = tripsById.get(tripId);

  if (!currentTrip) {
    return null;
  }

  const nextTrip = {
    ...currentTrip,
    ...patch
  };

  tripsById.set(tripId, nextTrip);
  return nextTrip;
};

const createTripEvent = async (event: Omit<TripTimelineEvent, "id">) => {
  const nextEvent: TripTimelineEvent = {
    id: `event-${Date.now()}-${tripEventsById.size + 1}`,
    ...event
  };

  hydrateEvent(nextEvent);
  return appendEvent(nextEvent);
};

const getTripTimeline = async (tripId: string): Promise<TripTimelineSnapshot> => ({
  events: (await listEventsByTrip(tripId))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map(hydrateEvent)
});

const getOpsEventStream = async () =>
  (await listRecentEvents(30)).map(hydrateEvent);

const getRecentOperationalNotifications = async (
  session: AuthSession,
  activeTrip: RideTrip | null
): Promise<OperationalNotification[]> => {
  if (!activeTrip) {
    return [];
  }

  const timeline = await getTripTimeline(activeTrip.id);

  return timeline.events.slice(0, 3).map((event) => ({
    id: event.id,
    level:
      event.type === "incident_created"
        ? "warning"
        : event.type === "trip_completed"
          ? "success"
          : "info",
    message:
      session.user.role === "driver" && event.actorRole === "driver"
        ? `Tu actualizacion: ${event.message}`
        : event.message,
    createdAt: event.occurredAt
  }));
};

const getOpsSnapshot = async (): Promise<OpsDashboardSnapshot> => {
  const [requestedTrips, completedTripsRaw, cancelledTripsRaw, allTripsRaw, incidentsRaw] =
    await Promise.all([
      listTripsByStatus("requested"),
      listTripsByStatus("trip_completed"),
      listTripsByStatus("cancelled"),
      readTrips(),
      readIncidents()
    ]);
  const allTrips = allTripsRaw
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .map(hydrateTrip);
  const queueTrips = requestedTrips
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .map(hydrateTrip);
  const completedTrips = completedTripsRaw
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .map(hydrateTrip);
  const cancelledTrips = cancelledTripsRaw
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .map(hydrateTrip);
  const activeTrips = allTrips.filter(
    (trip) =>
      trip.status !== "requested" &&
      trip.status !== "trip_completed" &&
      trip.status !== "cancelled"
  );
  const incidents = incidentsRaw
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(hydrateIncident);

  return {
    queueTrips,
    activeTrips,
    completedTrips,
    cancelledTrips,
    incidents,
    totals: {
      requested: queueTrips.length,
      active: activeTrips.length,
      completed: completedTrips.length,
      cancelled: cancelledTrips.length,
      openIncidents: incidents.filter((incident) => incident.status !== "resolved").length
    }
  };
};

const getCommercialMetrics = async (): Promise<CommercialMetricsSnapshot> => {
  const allTrips = (await readTrips()).map(hydrateTrip);
  const completedTrips = allTrips.filter((trip) => trip.status === "trip_completed");
  const cancelledTrips = allTrips.filter((trip) => trip.status === "cancelled");
  const totalRevenue = Number(
    completedTrips.reduce((sum, trip) => sum + trip.estimate.estimatedFare, 0).toFixed(2)
  );
  const totalDiscountAmount = Number(
    allTrips
      .reduce((sum, trip) => sum + trip.estimate.fareBreakdown.discountAmount, 0)
      .toFixed(2)
  );
  const averageCompletedFare =
    completedTrips.length === 0
      ? 0
      : Number((totalRevenue / completedTrips.length).toFixed(2));

  const promoPerformanceMap = new Map<string, { uses: number; totalDiscountAmount: number }>();

  for (const trip of allTrips) {
    const appliedPromotion = trip.estimate.appliedPromotion;
    if (!appliedPromotion) {
      continue;
    }

    const current = promoPerformanceMap.get(appliedPromotion.code) ?? {
      uses: 0,
      totalDiscountAmount: 0
    };

    current.uses += 1;
    current.totalDiscountAmount = Number(
      (current.totalDiscountAmount + appliedPromotion.discountAmount).toFixed(2)
    );
    promoPerformanceMap.set(appliedPromotion.code, current);
  }

  return {
    totalRevenue,
    totalDiscountAmount,
    completedTrips: completedTrips.length,
    cancelledTrips: cancelledTrips.length,
    averageCompletedFare,
    promoPerformance: Array.from(promoPerformanceMap.entries())
      .map(([code, value]) => ({
        code,
        uses: value.uses,
        totalDiscountAmount: value.totalDiscountAmount
      }))
      .sort((a, b) => b.uses - a.uses)
  };
};

const getTripHistoryForSession = async (session: AuthSession): Promise<TripHistorySnapshot> => {
  const trips = (
    session.user.role === "driver"
      ? await listTripsByDriver(session.user.id)
      : await listTripsByPassenger(session.user.id)
  )
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .map(hydrateTrip);

  return {
    trips
  };
};

app.get("/health", async () => {
  return {
    service: SERVICE_NAME,
    status: "ok",
    supabaseEnabled: appEnv.supabaseEnabled,
    persistence: appEnv.supabaseEnabled ? "supabase" : "local_json"
  };
});

app.get("/meta/trips", async () => {
  return {
    statuses: TRIP_STATUSES,
    events: TRIP_EVENT_TYPES
  };
});

app.get("/places/search", async (request, reply) => {
  const session = requireRole(
    await requireSession(request.headers.authorization),
    "passenger"
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const parsedQuery = placeSearchSchema.safeParse(request.query);

  if (!parsedQuery.success) {
    reply.status(400);
    return {
      error: "invalid_places_query"
    };
  }

  const normalizedQuery = parsedQuery.data.query.trim().toLowerCase();
  const results = searchablePlaces
    .filter(
      (place) =>
        place.label.toLowerCase().includes(normalizedQuery) ||
        place.address.toLowerCase().includes(normalizedQuery)
    )
    .slice(0, 6);

  const payload: PlaceSearchResult = {
    query: parsedQuery.data.query,
    results
  };

  return payload;
});

app.get("/ops/dashboard", async (request, reply) => {
  const session = requireAnyRole(
    await requireSession(request.headers.authorization),
    ["operator", "admin"]
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return getOpsSnapshot();
});

app.get("/ops/business", async (request, reply) => {
  const session = requireAnyRole(
    await requireSession(request.headers.authorization),
    ["operator", "admin"]
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return hydrateBusinessState({
    pricing: await getPricingConfig(),
    promotions: await listPromotions(),
    auditLog: await listBusinessAuditEntries()
  });
});

app.get("/ops/commercial-metrics", async (request, reply) => {
  const session = requireAnyRole(
    await requireSession(request.headers.authorization),
    ["operator", "admin"]
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return getCommercialMetrics();
});

app.get("/ops/events", async (request, reply) => {
  const session = requireAnyRole(
    await requireSession(request.headers.authorization),
    ["operator", "admin"]
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return {
    events: await getOpsEventStream()
  };
});

app.get("/ops/directory", async (request, reply) => {
  const session = requireAnyRole(
    await requireSession(request.headers.authorization),
    ["operator", "admin"]
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return hydrateDirectoryState({
    drivers: await listDriverProfiles(),
    passengers: await listPassengerProfiles()
  });
});

app.get("/ops/trips", async (request, reply) => {
  const session = requireAnyRole(
    await requireSession(request.headers.authorization),
    ["operator", "admin"]
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return {
    trips: (await readTrips())
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map(hydrateTrip)
  };
});

app.get("/ops/incidents", async (request, reply) => {
  const session = requireAnyRole(
    await requireSession(request.headers.authorization),
    ["operator", "admin"]
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return {
    incidents: (await readIncidents())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(hydrateIncident)
  };
});

app.post<{ Params: { incidentId: string }; Body: IncidentStatusUpdate }>(
  "/ops/incidents/:incidentId/status",
  async (request, reply) => {
    const session = requireAnyRole(
      await requireSession(request.headers.authorization),
      ["operator", "admin"]
    );

    if (!session) {
      reply.status(401);
      return {
        error: "invalid_session"
      };
    }

    const parsedPayload = incidentStatusSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      reply.status(400);
      return {
        error: "invalid_incident_status_payload"
      };
    }

      const incident =
        incidentsById.get(request.params.incidentId) ??
        (await getIncident(request.params.incidentId));

      if (!incident) {
        reply.status(404);
        return {
          error: "incident_not_found"
        };
      }

      incidentsById.set(incident.id, incident);

      const updatedIncident: TripIncident = {
        ...incident,
        status: parsedPayload.data.status
      };

      incidentsById.set(updatedIncident.id, updatedIncident);
      const persistedIncident = await saveIncident(updatedIncident);
      const trip = await getTripById(persistedIncident.tripId);

      if (trip) {
        publishTripRealtime(trip, `incident_${persistedIncident.status}`);
      }

      return persistedIncident;
  }
);

app.post<{ Params: { driverId: string }; Body: DriverApprovalUpdate }>(
  "/ops/drivers/:driverId/approval",
  async (request, reply) => {
    const session = requireAnyRole(
      await requireSession(request.headers.authorization),
      ["operator", "admin"]
    );

    if (!session) {
      reply.status(401);
      return {
        error: "invalid_session"
      };
    }

    const parsedPayload = driverApprovalSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      reply.status(400);
      return {
        error: "invalid_driver_approval_payload"
      };
    }

    const profile = driverProfilesById.get(request.params.driverId);

    if (!profile) {
      reply.status(404);
      return {
        error: "driver_not_found"
      };
    }

    const updatedProfile: DriverProfile = {
      ...profile,
      approvalStatus: parsedPayload.data.approvalStatus
    };

      const persistedProfile = await saveDriverProfile(updatedProfile);
      driverProfilesById.set(persistedProfile.id, persistedProfile);
      publishDirectoryRealtime(
        "driver_approval_updated",
        {
          userIds: [persistedProfile.id]
        },
        { driverProfile: persistedProfile }
      );
      return persistedProfile;
  }
);

app.post<{ Body: PricingConfigUpdate }>("/ops/pricing", async (request, reply) => {
  const session = requireAnyRole(
    await requireSession(request.headers.authorization),
    ["operator", "admin"]
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const parsedPayload = pricingConfigSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_pricing_payload"
    };
  }

  pricingConfig = await savePricingConfig(parsedPayload.data);
    const auditEntry = appendBusinessAudit(
      session,
      "pricing_updated",
      `Pricing actualizado a base ${parsedPayload.data.currency} ${parsedPayload.data.baseFare.toFixed(2)} y surge ${parsedPayload.data.surgeMultiplier.toFixed(1)}x`
    );
    await appendBusinessAuditEntry(auditEntry);
    publishBusinessRealtime("pricing_updated", {
      pricing: pricingConfig,
      auditEntry
    });
    return getBusinessSnapshot();
  });

app.post<{ Body: PromotionUpsertPayload }>("/ops/promotions", async (request, reply) => {
  const session = requireAnyRole(
    await requireSession(request.headers.authorization),
    ["operator", "admin"]
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const parsedPayload = promotionSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_promotion_payload"
    };
  }

  const promotion: Promotion = {
    id: `promo-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...parsedPayload.data,
    code: parsedPayload.data.code.trim().toUpperCase()
  };

  const persistedPromotion = await savePromotion(promotion);
  promotionsById.set(persistedPromotion.id, persistedPromotion);
    const auditEntry = appendBusinessAudit(
      session,
      "promotion_created",
      `Promocion ${persistedPromotion.code} creada para audiencia ${persistedPromotion.audience} en modo ${persistedPromotion.applyMode}`
    );
    await appendBusinessAuditEntry(auditEntry);
    publishBusinessRealtime("promotion_created", {
      promotion: persistedPromotion,
      auditEntry
    });
    reply.status(201);
    return persistedPromotion;
});

app.post<{ Params: { promotionId: string }; Body: PromotionUpsertPayload }>(
  "/ops/promotions/:promotionId",
  async (request, reply) => {
    const session = requireAnyRole(
      await requireSession(request.headers.authorization),
      ["operator", "admin"]
    );

    if (!session) {
      reply.status(401);
      return {
        error: "invalid_session"
      };
    }

    const parsedPayload = promotionSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      reply.status(400);
      return {
        error: "invalid_promotion_payload"
      };
    }

    const promotion = promotionsById.get(request.params.promotionId);

    if (!promotion) {
      reply.status(404);
      return {
        error: "promotion_not_found"
      };
    }

    const updatedPromotion: Promotion = {
      ...promotion,
      ...parsedPayload.data,
      code: parsedPayload.data.code.trim().toUpperCase()
    };

    const persistedPromotion = await savePromotion(updatedPromotion);
    promotionsById.set(persistedPromotion.id, persistedPromotion);
      const auditEntry = appendBusinessAudit(
        session,
        "promotion_updated",
        `Promocion ${persistedPromotion.code} actualizada y ahora esta ${persistedPromotion.isActive ? "activa" : "pausada"}`
      );
      await appendBusinessAuditEntry(auditEntry);
      publishBusinessRealtime("promotion_updated", {
        promotion: persistedPromotion,
        auditEntry
      });
      return persistedPromotion;
    }
  );

app.post("/auth/sign-in", async (request, reply) => {
  const parsedPayload = signInSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_sign_in_payload"
    };
  }

  let session: AuthSession;

  if (!isSupabaseReady) {
    reply.status(503);
    return {
      error: "auth_unavailable"
    };
  }

  try {
    session = await signInWithSupabase(parsedPayload.data);
  } catch (error) {
    reply.status(
      error instanceof Error && error.message === "role_mismatch" ? 403 : 401
    );
    return {
      error:
        error instanceof Error && error.message === "role_mismatch"
          ? "role_mismatch"
          : "invalid_credentials"
    };
  }

  await ensureProfileForSession(session);
  return session;
});

app.post("/auth/sign-up", async (request, reply) => {
  const parsedPayload = signUpSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_sign_up_payload"
    };
  }

  let session: AuthSession;

  if (!isSupabaseReady) {
    reply.status(503);
    return {
      error: "auth_unavailable"
    };
  }

  try {
    session = await signUpWithSupabase(parsedPayload.data);
  } catch {
    reply.status(409);
    return {
      error: "sign_up_failed"
    };
  }

  await ensureProfileForSession(session);
  publishDirectoryRealtime(
    "sign_up_profile_created",
    {
      userIds: session.user.role === "driver" ? [session.user.id] : undefined
    },
    {
      driverProfile:
        session.user.role === "driver"
          ? (await getDriverProfile(session.user.id)) ?? undefined
          : undefined,
      passengerProfile:
        session.user.role === "passenger"
          ? (await getPassengerProfile(session.user.id)) ?? undefined
          : undefined
    }
  );
  reply.status(201);
  return session;
});

app.post("/auth/refresh", async (request, reply) => {
  const parsedPayload = refreshSessionSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_refresh_payload"
    };
  }

  if (!isSupabaseReady) {
    reply.status(400);
    return {
      error: "refresh_not_available"
    };
  }

  try {
    const session = await refreshSupabaseSession(parsedPayload.data.refreshToken);
    await ensureProfileForSession(session);
    return session;
  } catch {
    reply.status(401);
    return {
      error: "invalid_refresh_token"
    };
  }
});

app.get("/auth/session", async (request, reply) => {
  const session = await requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  await ensureProfileForSession(session);
  return session;
});

app.get("/home/passenger", async (request, reply) => {
  const session = requireRole(
    await requireSession(request.headers.authorization),
    "passenger"
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const activeTrip = await getPassengerActiveTrip(session.user.id);

  return {
    ...DEFAULT_HOME_BOOTSTRAP,
    activeTripStatus: activeTrip?.status ?? null,
    notifications: await getRecentOperationalNotifications(session, activeTrip)
  };
});

app.get("/home/driver", async (request, reply) => {
  const session = requireRole(
    await requireSession(request.headers.authorization),
    "driver"
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const activeTrip = await getDriverActiveTrip(session.user.id);

  return {
    city: DEFAULT_HOME_BOOTSTRAP.city,
    queueSize: (await getDriverQueue()).length,
    activeTrip,
    driverProfile: await getDriverProfileById(session.user.id),
    notifications: await getRecentOperationalNotifications(session, activeTrip)
  };
});

app.post("/trips/estimate", async (request, reply) => {
  const session = requireRole(
    await requireSession(request.headers.authorization),
    "passenger"
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const parsedPayload = rideEstimateSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_estimate_payload"
    };
  }

  return estimateRide(parsedPayload.data, session.user.id);
});

app.post("/trips", async (request, reply) => {
  const session = requireRole(
    await requireSession(request.headers.authorization),
    "passenger"
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const parsedPayload = createTripSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_trip_payload"
    };
  }

  if (parsedPayload.data.passengerId !== session.user.id) {
    reply.status(403);
    return {
      error: "passenger_mismatch"
    };
  }

  const estimate = await estimateRide(parsedPayload.data, session.user.id);
  const trip: RideTrip = {
    id: `trip-${Date.now()}`,
    passengerId: parsedPayload.data.passengerId,
    passengerName: parsedPayload.data.passengerName,
    origin: parsedPayload.data.origin,
    destination: parsedPayload.data.destination,
    estimate,
    requestedPromoCode: parsedPayload.data.promoCode?.trim().toUpperCase(),
    status: "requested",
    requestedAt: new Date().toISOString()
  };

  const persistedTrip = await saveTrip(trip);
  tripsById.set(persistedTrip.id, persistedTrip);
  const tripRequestedEvent = await createTripEvent({
    tripId: persistedTrip.id,
    type: "trip_requested",
    occurredAt: persistedTrip.requestedAt,
    actorId: session.user.id,
    actorRole: session.user.role,
    message: `Solicitud creada desde ${persistedTrip.origin.label} hacia ${persistedTrip.destination.label}`
  });
  publishTripRealtime(persistedTrip, "trip_created");
  publishTripTimelineRealtime(persistedTrip, "trip_requested", tripRequestedEvent);
  reply.status(201);
  return persistedTrip;
});

app.get("/trips/active", async (request, reply) => {
  const session = await requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return {
    trip:
      session.user.role === "driver"
        ? await getDriverActiveTrip(session.user.id)
        : await getPassengerActiveTrip(session.user.id)
  };
});

app.get("/trips/history", async (request, reply) => {
  const session = await requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  if (session.user.role !== "passenger" && session.user.role !== "driver") {
    reply.status(403);
    return {
      error: "trip_history_not_available_for_role"
    };
  }

  return getTripHistoryForSession(session);
});

app.get<{ Params: { tripId: string } }>("/trips/:tripId/events", async (request, reply) => {
  const session = await requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const trip = await getTripById(request.params.tripId);

  if (!trip) {
    reply.status(404);
    return {
      error: "trip_not_found"
    };
  }

  const canSeeTrip =
    session.user.role === "passenger"
      ? trip.passengerId === session.user.id
      : session.user.role === "driver"
        ? trip.driverId === session.user.id
        : true;

  if (!canSeeTrip) {
    reply.status(403);
    return {
      error: "trip_events_not_allowed"
    };
  }

  return getTripTimeline(trip.id);
});

app.post<{ Body: CreateIncidentPayload }>("/incidents", async (request, reply) => {
  const session = await requireSession(request.headers.authorization);

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  const parsedPayload = incidentSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_incident_payload"
    };
  }

  const trip = await getTripById(parsedPayload.data.tripId);

  if (!trip) {
    reply.status(404);
    return {
      error: "trip_not_found"
    };
  }

  const incident: TripIncident = {
    id: `incident-${Date.now()}`,
    tripId: trip.id,
    reporterRole:
      session.user.role === "driver" ? "driver" : "passenger",
    reporterId: session.user.id,
    severity: parsedPayload.data.severity,
    category: parsedPayload.data.category,
    notes: parsedPayload.data.notes,
    createdAt: new Date().toISOString(),
    status: "open"
  };

  const persistedIncident = await saveIncident(incident);
  incidentsById.set(persistedIncident.id, persistedIncident);
  const incidentEvent = await createTripEvent({
    tripId: trip.id,
    type: "incident_created",
    occurredAt: persistedIncident.createdAt,
    actorId: session.user.id,
    actorRole: session.user.role,
    message: `Incidencia reportada por ${session.user.role}: ${persistedIncident.category}`
  });
  publishTripRealtime(trip, "incident_created");
  publishTripTimelineRealtime(trip, "incident_created", incidentEvent);
  reply.status(201);
  return persistedIncident;
});

app.post<{ Params: { tripId: string }; Body: CancelTripPayload }>(
  "/trips/:tripId/cancel",
  async (request, reply) => {
    const session = await requireSession(request.headers.authorization);

    if (!session) {
      reply.status(401);
      return {
        error: "invalid_session"
      };
    }

    const parsedPayload = cancelTripSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      reply.status(400);
      return {
        error: "invalid_cancel_payload"
      };
    }

    const trip = await getTripById(request.params.tripId);

    if (!trip) {
      reply.status(404);
      return {
        error: "trip_not_found"
      };
    }

    const sessionCanCancel =
      session.user.role === "passenger"
        ? trip.passengerId === session.user.id
        : trip.driverId === session.user.id;

    if (!sessionCanCancel) {
      reply.status(403);
      return {
        error: "trip_cancel_not_allowed"
      };
    }

    const cancelledTrip = patchTrip(trip.id, {
      status: "cancelled",
      cancellationReason: parsedPayload.data.reason,
      cancelledByRole:
        session.user.role === "driver" ? "driver" : "passenger",
      cancelledAt: new Date().toISOString(),
      driverEtaMinutes: undefined,
      currentDriverLocation: undefined
    });

    if (cancelledTrip) {
      const persistedTrip = await saveTrip(cancelledTrip);
      tripsById.set(persistedTrip.id, persistedTrip);
        const cancelledEvent = await createTripEvent({
          tripId: persistedTrip.id,
        type: "trip_cancelled",
        occurredAt: new Date().toISOString(),
        actorId: session.user.id,
        actorRole: session.user.role,
          message: `Viaje cancelado por ${session.user.role}`
        });
        publishTripRealtime(persistedTrip, "trip_cancelled");
        publishTripTimelineRealtime(persistedTrip, "trip_cancelled", cancelledEvent);
        return persistedTrip;
      }
    return cancelledTrip;
  }
);

app.get("/driver/trips/queue", async (request, reply) => {
  const session = requireRole(
    await requireSession(request.headers.authorization),
    "driver"
  );

  if (!session) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return {
    trips: await getDriverQueue()
  };
});

app.post<{ Params: { tripId: string } }>(
  "/driver/trips/:tripId/accept",
  async (request, reply) => {
    const session = requireRole(
      await requireSession(request.headers.authorization),
      "driver"
    );

    if (!session) {
      reply.status(401);
      return {
        error: "invalid_session"
      };
    }

    if (await getDriverActiveTrip(session.user.id)) {
      reply.status(409);
      return {
        error: "driver_already_has_active_trip"
      };
    }

    const driverProfile = await getDriverProfileById(session.user.id);

    if (!driverProfile || driverProfile.approvalStatus !== "approved") {
      reply.status(403);
      return {
        error: "driver_not_approved"
      };
    }

    const trip = await getTripById(request.params.tripId);

    if (!trip || trip.status !== "requested") {
      reply.status(404);
      return {
        error: "trip_not_available"
      };
    }

    const acceptedTrip = patchTrip(trip.id, {
      status: "matched",
      driverId: session.user.id,
      driverName: session.user.fullName,
      driverEtaMinutes: buildDriverEta("matched"),
      currentDriverLocation: buildDriverLocation(trip, "matched")
    });
    if (acceptedTrip) {
      const persistedTrip = await saveTrip(acceptedTrip);
      tripsById.set(persistedTrip.id, persistedTrip);
        const matchedEvent = await createTripEvent({
          tripId: persistedTrip.id,
        type: "trip_matched",
        occurredAt: new Date().toISOString(),
        actorId: session.user.id,
        actorRole: session.user.role,
          message: `${session.user.fullName} acepto la solicitud`
        });
        publishTripRealtime(persistedTrip, "trip_matched");
        publishTripTimelineRealtime(persistedTrip, "trip_matched", matchedEvent);
        return persistedTrip;
      }
    return acceptedTrip;
  }
);

app.post<{ Params: { tripId: string }; Body: DriverTripStatusUpdate }>(
  "/driver/trips/:tripId/status",
  async (request, reply) => {
    const session = requireRole(
      await requireSession(request.headers.authorization),
      "driver"
    );

    if (!session) {
      reply.status(401);
      return {
        error: "invalid_session"
      };
    }

    const trip = await getTripById(request.params.tripId);

    if (!trip || trip.driverId !== session.user.id) {
      reply.status(404);
      return {
        error: "trip_not_found_for_driver"
      };
    }

    const parsedPayload = driverStatusSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      reply.status(400);
      return {
        error: "invalid_status_payload"
      };
    }

    const currentIndex = DRIVER_STATUS_FLOW.indexOf(
      trip.status as DriverTripStatusUpdate["status"]
    );
    const nextIndex = DRIVER_STATUS_FLOW.indexOf(parsedPayload.data.status);

    if (trip.status === "matched" && parsedPayload.data.status !== "driver_en_route") {
      reply.status(409);
      return {
        error: "invalid_status_transition"
      };
    }

    if (trip.status !== "matched" && nextIndex !== currentIndex + 1) {
      reply.status(409);
      return {
        error: "invalid_status_transition"
      };
    }

    const nextStatus = parsedPayload.data.status;

    const updatedTrip = patchTrip(trip.id, {
      status: nextStatus,
      driverEtaMinutes: buildDriverEta(nextStatus),
      currentDriverLocation: buildDriverLocation(trip, nextStatus)
    });
    if (updatedTrip) {
      const persistedTrip = await saveTrip(updatedTrip);
      tripsById.set(persistedTrip.id, persistedTrip);
      const eventType =
        nextStatus === "driver_en_route"
          ? "driver_assigned"
          : nextStatus === "driver_arrived"
            ? "driver_arrived"
            : nextStatus === "trip_started"
              ? "trip_started"
              : "trip_completed";

        const statusEvent = await createTripEvent({
          tripId: persistedTrip.id,
        type: eventType,
        occurredAt: new Date().toISOString(),
        actorId: session.user.id,
        actorRole: session.user.role,
          message: `Estado actualizado a ${nextStatus}`
        });
        publishTripRealtime(persistedTrip, `trip_${nextStatus}`);
        publishTripTimelineRealtime(persistedTrip, `trip_${nextStatus}`, statusEvent);
        return persistedTrip;
      }
    return updatedTrip;
  }
);

export const bootstrapApp = async () => {
  if (isBootstrapped) {
    return app;
  }

  if (!isTestRuntime) {
    await realtimeHub.register(app);
    supabaseRealtimeBridge.start();
  }
  app.addHook("onClose", async () => {
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
  passengerProfilesById.clear();
  promotionsById.clear();
  businessAuditLog.length = 0;

  const persistedBusinessRules = await readBusinessRules().catch(() => ({
    pricing: DEFAULT_PRICING_CONFIG,
    promotions: DEFAULT_PROMOTIONS,
    auditLog: []
  }));
  hydrateBusinessState(persistedBusinessRules);
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
