import type {
  BusinessAuditEntry,
  DriverProfile,
  InternalUserProfile,
  OperationalNotification,
  PassengerProfile,
  PricingConfig,
  Promotion,
  RealtimeEnvelope,
  RideTrip,
  TripTimelineEvent,
  UserRole
} from "@diva-drive/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseRealtimeBridge,
  type RealtimeHub,
  type SupabaseRealtimeBridge
} from "../realtime.js";

type RealtimePublishEvent = Omit<RealtimeEnvelope, "id" | "occurredAt"> & {
  trip?: RideTrip;
  timelineEvent?: TripTimelineEvent;
  notification?: OperationalNotification;
  driverProfile?: DriverProfile;
  internalUserProfile?: InternalUserProfile;
  passengerProfile?: PassengerProfile;
  pricing?: PricingConfig;
  promotion?: Promotion;
  auditEntry?: BusinessAuditEntry;
};

type RealtimeTargets = {
  ops?: boolean;
  userIds?: string[];
  roles?: UserRole[];
};

interface RealtimeServiceDependencies {
  realtimeHub: RealtimeHub;
  supabase: SupabaseClient<any, any, any> | null;
  schema: string;
  getTripById: (tripId: string) => Promise<RideTrip | null>;
  getEventById: (eventId: string) => Promise<TripTimelineEvent | null>;
  hydrateEvent: (event: TripTimelineEvent) => TripTimelineEvent;
  getDriverProfile: (driverId: string) => Promise<DriverProfile | null>;
  hydrateDriverProfile: (profile: DriverProfile) => DriverProfile;
  getInternalUserProfile: (internalUserId: string) => Promise<InternalUserProfile | null>;
  hydrateInternalUserProfile: (profile: InternalUserProfile) => InternalUserProfile;
  getPassengerProfile: (passengerId: string) => Promise<PassengerProfile | null>;
  hydratePassengerProfile: (profile: PassengerProfile) => PassengerProfile;
  getPricingConfig: () => Promise<PricingConfig>;
  getPromotionById: (promotionId: string) => Promise<Promotion | null>;
  hydratePromotion: (promotion: Promotion) => Promotion;
  getBusinessAuditEntryById: (entryId: string) => Promise<BusinessAuditEntry | null>;
  hydrateBusinessAuditEntry: (entry: BusinessAuditEntry) => BusinessAuditEntry;
}

const realtimeDedupWindowMs = 2500;

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

const getTripAudience = (trip: Pick<RideTrip, "passengerId" | "driverId">) =>
  [trip.passengerId, trip.driverId].filter(Boolean) as string[];

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

export const createRealtimeService = ({
  realtimeHub,
  supabase,
  schema,
  getTripById,
  getEventById,
  hydrateEvent,
  getDriverProfile,
  hydrateDriverProfile,
  getInternalUserProfile,
  hydrateInternalUserProfile,
  getPassengerProfile,
  hydratePassengerProfile,
  getPricingConfig,
  getPromotionById,
  hydratePromotion,
  getBusinessAuditEntryById,
  hydrateBusinessAuditEntry
}: RealtimeServiceDependencies) => {
  const recentRealtimePublications = new Map<string, number>();

  const getRealtimeDedupKey = (event: RealtimePublishEvent, targets: RealtimeTargets) =>
    stableSerialize({
      event,
      targets: {
        ops: targets.ops ?? false,
        userIds: [...(targets.userIds ?? [])].sort(),
        roles: [...(targets.roles ?? [])].sort()
      }
    });

  const shouldSkipRealtimePublish = (event: RealtimePublishEvent, targets: RealtimeTargets) => {
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

  const publishRealtime = (event: RealtimePublishEvent, targets: RealtimeTargets) => {
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
        notification: payload.timelineEvent
          ? toNotificationFromEvent(payload.timelineEvent)
          : undefined,
        trip: payload.trip
      },
      { userIds }
    );
  };

  const publishDirectoryRealtime = (
    reason: string,
    targets?: { userIds?: string[] },
    payload?: {
      driverProfile?: DriverProfile;
      internalUserProfile?: InternalUserProfile;
      passengerProfile?: PassengerProfile;
    }
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
    publishRealtime(
      { type: "ops.events.refresh", reason, auditEntry: payload?.auditEntry },
      { ops: true }
    );
  };

  const supabaseRealtimeBridge: SupabaseRealtimeBridge = createSupabaseRealtimeBridge({
    supabase,
    schema,
    onTripChanged: (payload) => {
      publishTripRealtimeByAudience(payload);
    },
    onTripTimelineChanged: (payload) => {
      publishTripTimelineRealtimeByAudience(payload);
    },
    onDirectoryChanged: ({ userId, reason, driverProfile, internalUserProfile, passengerProfile }) => {
      publishDirectoryRealtime(
        reason,
        userId ? { userIds: [userId] } : undefined,
        {
          driverProfile,
          internalUserProfile,
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
    resolveInternalUserProfile: async (internalUserId) => {
      const profile = await getInternalUserProfile(internalUserId);
      return profile ? hydrateInternalUserProfile(profile) : null;
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

  return {
    publishBusinessRealtime,
    publishDirectoryRealtime,
    publishTripRealtime,
    publishTripTimelineRealtime,
    supabaseRealtimeBridge
  };
};
