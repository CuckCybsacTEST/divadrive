import {
  getTripReservationExpiresAt,
  getTripRequestExpiresAt,
  type RideTrip,
  type TripIncident,
  type TripTimelineEvent
} from "@diva-drive/domain";
import { mapPersistenceError } from "../errors.js";
import type { TripRepository, TripWriteRepository } from "./contracts.js";

interface TripRepositoryDependencies {
  incidentsById: Map<string, TripIncident>;
  tripEventsById: Map<string, TripTimelineEvent>;
  tripsById: Map<string, RideTrip>;
  appendEvent: (event: TripTimelineEvent) => Promise<TripTimelineEvent>;
  getIncident: (incidentId: string) => Promise<TripIncident | null>;
  getTrip: (tripId: string) => Promise<RideTrip | null>;
  listEventsByTrip: (tripId: string) => Promise<TripTimelineEvent[]>;
  listRecentEvents: (limit: number) => Promise<TripTimelineEvent[]>;
  listTripsByDriver: (driverId: string) => Promise<RideTrip[]>;
  listTripsByPassenger: (passengerId: string) => Promise<RideTrip[]>;
  listTripsByStatus: (status: RideTrip["status"]) => Promise<RideTrip[]>;
  readIncidents: () => Promise<TripIncident[]>;
  readTrips: () => Promise<RideTrip[]>;
  saveIncident: (incident: TripIncident) => Promise<TripIncident>;
  saveTrip: (trip: RideTrip) => Promise<RideTrip>;
}

export const createTripRepository = ({
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
}: TripRepositoryDependencies): TripRepository => {
  const normalizeTrip = (trip: RideTrip, fallbackTrip?: RideTrip): RideTrip => {
    const cachedTrip = tripsById.get(trip.id);
    const fallbackReservationTrip = fallbackTrip ?? cachedTrip;

    if (trip.status !== "requested" && trip.status !== "expired") {
      return {
        ...trip,
        expiresAt: undefined,
        reservedDriverId: undefined,
        reservedAt: undefined,
        reservedUntil: undefined
      };
    }

    return {
      ...trip,
      expiresAt: trip.expiresAt ?? cachedTrip?.expiresAt ?? getTripRequestExpiresAt(trip.requestedAt),
      reservedDriverId: trip.reservedDriverId ?? fallbackReservationTrip?.reservedDriverId,
      reservedAt: trip.reservedAt ?? fallbackReservationTrip?.reservedAt,
      reservedUntil:
        trip.reservedUntil ??
        fallbackReservationTrip?.reservedUntil ??
        (trip.reservedDriverId ? getTripReservationExpiresAt() : undefined)
    };
  };

  const cacheTrip = (trip: RideTrip, fallbackTrip?: RideTrip) => {
    const normalizedTrip = normalizeTrip(trip, fallbackTrip);
    tripsById.set(normalizedTrip.id, normalizedTrip);
    return normalizedTrip;
  };

  const cacheIncident = (incident: TripIncident) => {
    incidentsById.set(incident.id, incident);
    return incident;
  };

  const cacheEvent = (event: TripTimelineEvent) => {
    tripEventsById.set(event.id, event);
    return event;
  };

  return {
    async appendEvent(event) {
      try {
        return cacheEvent(await appendEvent(cacheEvent(event)));
      } catch (error) {
        return mapPersistenceError(error, {
          conflictCode: "trip_persistence_failed",
          fallbackCode: "trip_persistence_failed"
        });
      }
    },

    cacheEvent,
    cacheIncident,
    cacheTrip,

    async getIncidentById(incidentId) {
      const cachedIncident = incidentsById.get(incidentId);
      if (cachedIncident) {
        return cachedIncident;
      }

      const incident = await getIncident(incidentId);
      return incident ? cacheIncident(incident) : null;
    },

    async getTripById(tripId) {
      const cachedTrip = tripsById.get(tripId);
      if (cachedTrip) {
        return cachedTrip;
      }

      const trip = await getTrip(tripId);
      return trip ? cacheTrip(trip) : null;
    },

    async listEventsByTrip(tripId) {
      return (await listEventsByTrip(tripId)).map(cacheEvent);
    },

    async listIncidents() {
      return (await readIncidents()).map(cacheIncident);
    },

    async listRecentEvents(limit) {
      return (await listRecentEvents(limit)).map(cacheEvent);
    },

    async listTrips() {
      return (await readTrips()).map((trip) => cacheTrip(trip));
    },

    async listTripsByDriver(driverId) {
      return (await listTripsByDriver(driverId)).map((trip) => cacheTrip(trip));
    },

    async listTripsByPassenger(passengerId) {
      return (await listTripsByPassenger(passengerId)).map((trip) => cacheTrip(trip));
    },

    async listTripsByStatus(status) {
      return (await listTripsByStatus(status)).map((trip) => cacheTrip(trip));
    },

    patchCachedTrip(tripId, patch) {
      const currentTrip = tripsById.get(tripId);
      if (!currentTrip) {
        return null;
      }

      return cacheTrip({
        ...currentTrip,
        ...patch
      });
    },

    async saveIncident(incident) {
      try {
        return cacheIncident(await saveIncident(incident));
      } catch (error) {
        return mapPersistenceError(error, {
          conflictCode: "incident_persistence_failed",
          fallbackCode: "incident_persistence_failed"
        });
      }
    },

    async saveTrip(trip) {
      try {
        return cacheTrip(await saveTrip(trip), trip);
      } catch (error) {
        return mapPersistenceError(error, {
          conflictCode: "trip_persistence_failed",
          fallbackCode: "trip_persistence_failed"
        });
      }
    }
  };
};

export const createTripWriteRepository = (
  dependencies: TripRepositoryDependencies
): TripWriteRepository => createTripRepository(dependencies);
