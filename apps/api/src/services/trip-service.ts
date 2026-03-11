import type {
  AuthSession,
  OperationalNotification,
  RideTrip,
  TripHistorySnapshot,
  TripTimelineEvent,
  TripTimelineSnapshot
} from "@diva-drive/domain";
import {
  getTripReservationExpiresAt,
  isTripRequestExpired,
  isTripReservationActive
} from "@diva-drive/domain";
import type { DirectoryRepository, TripRepository } from "../repositories/contracts.js";

interface TripServiceDependencies {
  directoryRepository: Pick<DirectoryRepository, "getDriverProfileById">;
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
  directoryRepository,
  tripRepository
}: TripServiceDependencies) => {
  const reserveTripForDriver = async (trip: RideTrip, driverId: string, now = Date.now()) => {
    if (trip.status !== "requested") {
      return trip;
    }

    if (isTripReservationActive(trip, now) && trip.reservedDriverId === driverId) {
      const refreshedReservationTrip = tripRepository.patchCachedTrip(trip.id, {
        reservedAt: new Date(now).toISOString(),
        reservedDriverId: driverId,
        reservedUntil: getTripReservationExpiresAt(now)
      });

      return refreshedReservationTrip
        ? tripRepository.saveTrip(refreshedReservationTrip)
        : trip;
    }

    if (isTripReservationActive(trip, now) && trip.reservedDriverId !== driverId) {
      return trip;
    }

    const reservedTrip = tripRepository.patchCachedTrip(trip.id, {
      reservedAt: new Date(now).toISOString(),
      reservedDriverId: driverId,
      reservedUntil: getTripReservationExpiresAt(now)
    });

    return reservedTrip ? tripRepository.saveTrip(reservedTrip) : trip;
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

  const getDriverQueue = async (driverId: string) => {
    await expireStaleRequestedTrips();
    const requestedTrips = await tripRepository.listTripsByStatus("requested");
    const driverProfile = await directoryRepository.getDriverProfileById(driverId);
    const driverLocation = driverProfile?.lastKnownLocation;
    const now = Date.now();
    const eligibleTrips = requestedTrips.filter(
      (trip) => !isTripReservationActive(trip, now) || trip.reservedDriverId === driverId
    );

    if (!driverLocation) {
      const queue = eligibleTrips.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
      return Promise.all(queue.slice(0, 3).map((trip) => reserveTripForDriver(trip, driverId, now)));
    }

    const prioritizedQueue = [...eligibleTrips].sort((a, b) => {
      const distanceToTripA = distanceKmBetween(driverLocation, a.origin);
      const distanceToTripB = distanceKmBetween(driverLocation, b.origin);
      return distanceToTripA - distanceToTripB || b.requestedAt.localeCompare(a.requestedAt);
    });

    return Promise.all(
      prioritizedQueue.slice(0, 3).map((trip) => reserveTripForDriver(trip, driverId, now))
    );
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

  return {
    createTripEvent,
    expireStaleRequestedTrips,
    getDriverActiveTrip,
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
