import type {
  AuthSession,
  DriverEarningsSnapshot,
  OperationalNotification,
  OperationalZone,
  PricingConfig,
  RideTrip,
  TripHistorySnapshot,
  TripTimelineEvent,
  TripTimelineSnapshot
} from "@diva-drive/domain";
import {
  isPointWithinOperationalZone,
  getTripReservationExpiresAt,
  isTripRequestExpired,
  isTripReservationActive
} from "@diva-drive/domain";
import type { DirectoryRepository, TripRepository } from "../repositories/contracts.js";

interface TripServiceDependencies {
  getOperationalZones: () => OperationalZone[];
  getPricingConfig: () => PricingConfig;
  directoryRepository: Pick<
    DirectoryRepository,
    "getDriverProfileById" | "listDriverProfiles"
  >;
  tripRepository: Pick<
    TripRepository,
    | "appendEvent"
    | "getTripById"
    | "listEventsByTrip"
    | "listTripsByDriver"
    | "listTripsByPassenger"
    | "listTripsByStatus"
    | "patchCachedTrip"
    | "saveTrip"
  >;
}

interface DriverQueueSnapshot {
  trips: RideTrip[];
  reassignedOffers: Array<{
    trip: RideTrip;
    timelineEvent: TripTimelineEvent;
  }>;
}

const toRadians = (value: number) => (value * Math.PI) / 180;

const distanceKmBetween = (
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number }
) => {
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

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

export const createTripService = ({
  getOperationalZones,
  getPricingConfig,
  directoryRepository,
  tripRepository
}: TripServiceDependencies) => {
  const DRIVER_QUEUE_OFFER_LIMIT = 1;

  const isDriverEligibleForTrip = (
    driverProfile: Awaited<ReturnType<DirectoryRepository["getDriverProfileById"]>>,
    trip: RideTrip,
    operationalZones = getOperationalZones()
  ) => {
    if (
      !driverProfile ||
      driverProfile.approvalStatus !== "approved" ||
      driverProfile.availabilityStatus !== "online"
    ) {
      return false;
    }

    if (!trip.operationalZoneId) {
      return true;
    }

    if (!driverProfile.lastKnownLocation) {
      return false;
    }

    const zone = operationalZones.find((currentZone) => currentZone.id === trip.operationalZoneId);
    return zone ? isPointWithinOperationalZone(driverProfile.lastKnownLocation, zone) : false;
  };

  const recycleTripOfferWindowIfNeeded = async (trip: RideTrip, now = Date.now()) => {
    if (isTripReservationActive(trip, now) || !trip.offeredDriverIds?.length) {
      return trip;
    }

    const operationalZones = getOperationalZones();
    const eligibleDriverIds = (await directoryRepository.listDriverProfiles())
      .filter((driverProfile) => isDriverEligibleForTrip(driverProfile, trip, operationalZones))
      .map((driverProfile) => driverProfile.id);

    if (
      eligibleDriverIds.length === 0 ||
      !eligibleDriverIds.every((driverId) => trip.offeredDriverIds?.includes(driverId))
    ) {
      return trip;
    }

    const recycledTrip = tripRepository.patchCachedTrip(trip.id, {
      reservedDriverId: undefined,
      reservedAt: undefined,
      reservedUntil: undefined,
      offeredDriverIds: []
    });

    return recycledTrip ? tripRepository.saveTrip(recycledTrip) : trip;
  };

  const reserveTripForDriver = async (
    trip: RideTrip,
    driverId: string,
    now = Date.now()
  ): Promise<{
    trip: RideTrip;
    timelineEvent?: TripTimelineEvent;
  }> => {
    if (trip.status !== "requested") {
      return { trip };
    }

    if (isTripReservationActive(trip, now) && trip.reservedDriverId === driverId) {
      const refreshedReservationTrip = tripRepository.patchCachedTrip(trip.id, {
        reservedAt: new Date(now).toISOString(),
        reservedDriverId: driverId,
        reservedUntil: getTripReservationExpiresAt(now)
      });

      return refreshedReservationTrip
        ? { trip: await tripRepository.saveTrip(refreshedReservationTrip) }
        : { trip };
    }

    if (isTripReservationActive(trip, now) && trip.reservedDriverId !== driverId) {
      return { trip };
    }

    const reservedTrip = tripRepository.patchCachedTrip(trip.id, {
      reservedAt: new Date(now).toISOString(),
      reservedDriverId: driverId,
      reservedUntil: getTripReservationExpiresAt(now),
      offeredDriverIds: Array.from(new Set([...(trip.offeredDriverIds ?? []), driverId]))
    });
    if (!reservedTrip) {
      return { trip };
    }

    const persistedTrip = await tripRepository.saveTrip(reservedTrip);
    if ((trip.offeredDriverIds?.length ?? 0) === 0 || trip.offeredDriverIds?.includes(driverId)) {
      return { trip: persistedTrip };
    }

    const timelineEvent = await createTripEvent({
      tripId: persistedTrip.id,
      type: "trip_offer_reassigned",
      occurredAt: new Date(now).toISOString(),
      message: "La solicitud fue reasignada a otra conductora elegible"
    });

    return {
      trip: persistedTrip,
      timelineEvent
    };
  };

  const expireTripIfNeeded = async (trip: RideTrip | null) => {
    if (!trip || !isTripRequestExpired(trip)) {
      return null;
    }

    const expiredTrip = tripRepository.patchCachedTrip(trip.id, {
      status: "expired",
      reservedDriverId: undefined,
      reservedAt: undefined,
      reservedUntil: undefined
    });

    if (!expiredTrip) {
      return null;
    }

    const persistedTrip = await tripRepository.saveTrip(expiredTrip);
    const timelineEvent = await createTripEvent({
      tripId: persistedTrip.id,
      type: "trip_expired",
      occurredAt: new Date().toISOString(),
      message: "La solicitud expiro por falta de asignacion dentro del tiempo operativo"
    });

    return {
      trip: persistedTrip,
      timelineEvent
    };
  };

  const expireStaleRequestedTrips = async () => {
    const requestedTrips = await tripRepository.listTripsByStatus("requested");
    const expiredTrips = [];

    for (const trip of requestedTrips) {
      const expiredTrip = await expireTripIfNeeded(trip);
      if (expiredTrip) {
        expiredTrips.push(expiredTrip);
      }
    }

    return expiredTrips;
  };

  const getPassengerActiveTrip = async (passengerId: string) => {
    await expireStaleRequestedTrips();
    const trips = (await tripRepository.listTripsByPassenger(passengerId)).filter(
      (trip) =>
        trip.passengerId === passengerId &&
        trip.status !== "trip_completed" &&
        trip.status !== "cancelled" &&
        trip.status !== "expired"
    );

    return trips.at(-1) ?? null;
  };

  const getDriverActiveTrip = async (driverId: string) => {
    await expireStaleRequestedTrips();
    return (
      (await tripRepository.listTripsByDriver(driverId)).find(
        (currentTrip) =>
          currentTrip.driverId === driverId &&
          currentTrip.status !== "trip_completed" &&
          currentTrip.status !== "cancelled" &&
          currentTrip.status !== "expired"
      ) ?? null
    );
  };

  const getDriverQueue = async (driverId: string): Promise<DriverQueueSnapshot> => {
    await expireStaleRequestedTrips();
    const requestedTrips = await Promise.all(
      (await tripRepository.listTripsByStatus("requested")).map((trip) =>
        recycleTripOfferWindowIfNeeded(trip)
      )
    );
    const driverProfile = await directoryRepository.getDriverProfileById(driverId);
    const driverLocation = driverProfile?.lastKnownLocation;
    const operationalZones = getOperationalZones();
    const now = Date.now();
    const eligibleTrips = requestedTrips.filter((trip) => {
      if (isTripReservationActive(trip, now) && trip.reservedDriverId !== driverId) {
        return false;
      }

      if (
        !isTripReservationActive(trip, now) &&
        trip.offeredDriverIds?.includes(driverId)
      ) {
        return false;
      }

      if (!trip.operationalZoneId) {
        return true;
      }

      if (!driverLocation) {
        return false;
      }

      const zone = operationalZones.find((currentZone) => currentZone.id === trip.operationalZoneId);
      return zone ? isPointWithinOperationalZone(driverLocation, zone) : false;
    });

    if (!driverLocation) {
      const queue = eligibleTrips.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
      const reservedTrips = await Promise.all(
        queue
          .slice(0, DRIVER_QUEUE_OFFER_LIMIT)
          .map((trip) => reserveTripForDriver(trip, driverId, now))
      );
      return {
        trips: reservedTrips.map((entry) => entry.trip),
        reassignedOffers: reservedTrips.flatMap((entry) =>
          entry.timelineEvent ? [{ trip: entry.trip, timelineEvent: entry.timelineEvent }] : []
        )
      };
    }

    const prioritizedQueue = [...eligibleTrips].sort((a, b) => {
      const distanceToTripA = distanceKmBetween(driverLocation, a.origin);
      const distanceToTripB = distanceKmBetween(driverLocation, b.origin);
      return distanceToTripA - distanceToTripB || b.requestedAt.localeCompare(a.requestedAt);
    });

    const reservedTrips = await Promise.all(
      prioritizedQueue
        .slice(0, DRIVER_QUEUE_OFFER_LIMIT)
        .map((trip) => reserveTripForDriver(trip, driverId, now))
    );
    return {
      trips: reservedTrips.map((entry) => entry.trip),
      reassignedOffers: reservedTrips.flatMap((entry) =>
        entry.timelineEvent ? [{ trip: entry.trip, timelineEvent: entry.timelineEvent }] : []
      )
    };
  };

  const getDriverProfileById = async (driverId: string) =>
    directoryRepository.getDriverProfileById(driverId);

  const patchTrip = (tripId: string, patch: Parameters<TripRepository["patchCachedTrip"]>[1]) =>
    tripRepository.patchCachedTrip(tripId, patch);

  const createTripEvent = async (event: Omit<TripTimelineEvent, "id">) => {
    const nextEvent: TripTimelineEvent = {
      id: `event-${Date.now()}`,
      ...event
    };

    return tripRepository.appendEvent(nextEvent);
  };

  const getTripTimeline = async (tripId: string): Promise<TripTimelineSnapshot> => ({
    events: (await tripRepository.listEventsByTrip(tripId)).sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt)
    )
  });

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

  const getTripHistoryForSession = async (
    session: AuthSession
  ): Promise<TripHistorySnapshot> => {
    const trips =
      session.user.role === "driver"
        ? await tripRepository.listTripsByDriver(session.user.id)
        : await tripRepository.listTripsByPassenger(session.user.id);

    return {
      trips: trips.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    };
  };

  const getDriverEarnings = async (driverId: string): Promise<DriverEarningsSnapshot> => {
    const trips = await tripRepository.listTripsByDriver(driverId);
    const pricingConfig = getPricingConfig();
    const completedTrips = trips.filter((trip) => trip.status === "trip_completed");
    const cancelledTrips = trips.filter((trip) => trip.status === "cancelled");
    const grossEarnings = Number(
      completedTrips
        .reduce((total, trip) => total + trip.estimate.estimatedFare, 0)
        .toFixed(2)
    );
    const platformFees = Number(
      (grossEarnings * (1 - pricingConfig.driverPayoutRate)).toFixed(2)
    );

    return {
      currency: completedTrips[0]?.estimate.currency ?? pricingConfig.currency,
      completedTrips: completedTrips.length,
      cancelledTrips: cancelledTrips.length,
      grossEarnings,
      platformFees,
      netEarnings: Number(Math.max(grossEarnings - platformFees, 0).toFixed(2))
    };
  };

  return {
    createTripEvent,
    expireStaleRequestedTrips,
    getDriverActiveTrip,
    getDriverEarnings,
    getDriverProfileById,
    getDriverQueue,
    getPassengerActiveTrip,
    getRecentOperationalNotifications,
    getTripById: tripRepository.getTripById,
    getTripHistoryForSession,
    getTripTimeline,
    patchTrip
  };
};
