import type {
  DriverAvailabilityUpdate,
  DriverProfile,
  DriverTripStatusUpdate,
  RideTrip
} from "@diva-drive/domain";
import { isPointWithinOperationalZone, isTripReservationActive } from "@diva-drive/domain";
import { apiError } from "../errors.js";
import { requireSessionOrThrow } from "./helpers.js";
import type { DriverRoutesContext } from "./context.js";

export const registerDriverRoutes = (context: DriverRoutesContext) => {
  const {
    app,
    requireSession,
    requireRole,
    getDriverQueue,
    getDriverActiveTrip,
    getDriverEarnings,
    getDriverProfileById,
    getOperationalZoneById,
    driverAvailabilitySchema,
    getTripById,
    patchTrip,
    buildDriverEta,
    buildDriverLocation,
    saveTrip,
    tripsById,
    createTripEvent,
    publishTripRealtime,
    publishTripTimelineRealtime,
    saveDriverProfile,
    publishDirectoryRealtime,
    driverStatusSchema,
    driverStatusFlow
  } = context;

  app.post<{ Body: DriverAvailabilityUpdate }>(
    "/driver/availability",
    async (request) => {
      const session = requireSessionOrThrow(
        requireRole(await requireSession(request.headers.authorization), "driver")
      );

      const parsedPayload = driverAvailabilitySchema.safeParse(request.body);

      if (!parsedPayload.success) {
        apiError(400, "invalid_driver_availability_payload");
      }

      const payload = parsedPayload.data as DriverAvailabilityUpdate;
      const driverProfile = await getDriverProfileById(session.user.id);

      if (!driverProfile) {
        apiError(404, "driver_not_found");
      }
      const currentDriverProfile = driverProfile as DriverProfile;

      if (payload.availabilityStatus === "online" && currentDriverProfile.operationalStatus !== "active") {
        apiError(403, "driver_blocked");
      }

      if (payload.availabilityStatus === "online" && currentDriverProfile.approvalStatus !== "approved") {
        apiError(403, "driver_not_approved");
      }

      const persistedProfile = await saveDriverProfile({
        ...currentDriverProfile,
        availabilityStatus: payload.availabilityStatus,
        lastKnownLocation:
          payload.currentLocation ?? currentDriverProfile.lastKnownLocation,
        lastLocationAt: payload.currentLocation
          ? new Date().toISOString()
          : currentDriverProfile.lastLocationAt
      });

      publishDirectoryRealtime(
        "driver_availability_updated",
        { userIds: [persistedProfile.id] },
        { driverProfile: persistedProfile }
      );

      return persistedProfile;
    }
  );

  app.get("/driver/trips/queue", async (request) => {
    const session = requireSessionOrThrow(
      requireRole(await requireSession(request.headers.authorization), "driver")
    );
    const driverProfile = await getDriverProfileById(session.user.id);

    if (
      !driverProfile ||
      driverProfile.operationalStatus !== "active" ||
      driverProfile.availabilityStatus !== "online"
    ) {
      return {
        trips: []
      };
    }

    const queue = await getDriverQueue(session.user.id);

    for (const reassignedOffer of queue.reassignedOffers) {
      publishTripRealtime(reassignedOffer.trip, "trip_offer_reassigned");
      publishTripTimelineRealtime(
        reassignedOffer.trip,
        "trip_offer_reassigned",
        reassignedOffer.timelineEvent
      );
    }

    return {
      trips: queue.trips
    };
  });

  app.get("/driver/earnings", async (request) => {
    const session = requireSessionOrThrow(
      requireRole(await requireSession(request.headers.authorization), "driver")
    );

    return getDriverEarnings(session.user.id);
  });

  app.post<{ Params: { tripId: string } }>(
    "/driver/trips/:tripId/accept",
    async (request) => {
      const session = requireSessionOrThrow(
        requireRole(await requireSession(request.headers.authorization), "driver")
      );

      if (await getDriverActiveTrip(session.user.id)) {
        apiError(409, "driver_already_has_active_trip");
      }

      const driverProfile = await getDriverProfileById(session.user.id);

      if (!driverProfile || driverProfile.approvalStatus !== "approved") {
        apiError(403, "driver_not_approved");
      }
      const currentDriverProfile = driverProfile as DriverProfile;

      if (currentDriverProfile.operationalStatus !== "active") {
        apiError(403, "driver_blocked");
      }

      if (currentDriverProfile.availabilityStatus !== "online") {
        apiError(403, "driver_offline");
      }

      const trip = await getTripById(request.params.tripId);

      if (!trip || trip.status !== "requested") {
        apiError(404, "trip_not_available");
      }
      const currentTrip = trip as RideTrip;
      const tripOperationalZone = currentTrip.operationalZoneId
        ? getOperationalZoneById(currentTrip.operationalZoneId)
        : null;

      if (
        isTripReservationActive(currentTrip) &&
        currentTrip.reservedDriverId !== session.user.id
      ) {
        apiError(409, "trip_reserved_for_another_driver");
      }

      if (
        !isTripReservationActive(currentTrip) ||
        currentTrip.reservedDriverId !== session.user.id
      ) {
        apiError(409, "trip_reservation_required");
      }

      if (
        tripOperationalZone &&
        (!currentDriverProfile.lastKnownLocation ||
          !isPointWithinOperationalZone(
            currentDriverProfile.lastKnownLocation,
            tripOperationalZone
          ))
      ) {
        apiError(403, "driver_outside_operational_zone");
      }

      const acceptedTrip = patchTrip(currentTrip.id, {
        status: "matched",
        driverId: session.user.id,
        driverName: session.user.fullName,
        driverEtaMinutes: buildDriverEta("matched"),
        currentDriverLocation: buildDriverLocation(currentTrip, "matched"),
        reservedDriverId: undefined,
        reservedAt: undefined,
        reservedUntil: undefined,
        offeredDriverIds: undefined
      });

      if (!acceptedTrip) {
        return acceptedTrip;
      }

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
  );

  app.post<{ Params: { tripId: string }; Body: DriverTripStatusUpdate }>(
    "/driver/trips/:tripId/status",
    async (request) => {
      const session = requireSessionOrThrow(
        requireRole(await requireSession(request.headers.authorization), "driver")
      );

      const trip = await getTripById(request.params.tripId);

      if (!trip || trip.driverId !== session.user.id) {
        apiError(404, "trip_not_found_for_driver");
      }
      const currentTrip = trip as RideTrip;
      const driverProfile = await getDriverProfileById(session.user.id);

      if (!driverProfile || driverProfile.operationalStatus !== "active") {
        apiError(403, "driver_blocked");
      }

      const parsedPayload = driverStatusSchema.safeParse(request.body);

      if (!parsedPayload.success) {
        apiError(400, "invalid_status_payload");
      }

      const payload = parsedPayload.data as DriverTripStatusUpdate;
      const currentIndex = driverStatusFlow.indexOf(
        currentTrip.status as DriverTripStatusUpdate["status"]
      );
      const nextIndex = driverStatusFlow.indexOf(payload.status);

      if (currentTrip.status === "matched" && payload.status !== "driver_en_route") {
        apiError(409, "invalid_status_transition");
      }

      if (currentTrip.status !== "matched" && nextIndex !== currentIndex + 1) {
        apiError(409, "invalid_status_transition");
      }

      const nextStatus = payload.status;
      const updatedTrip = patchTrip(currentTrip.id, {
        status: nextStatus,
        driverEtaMinutes: buildDriverEta(nextStatus),
        currentDriverLocation: buildDriverLocation(currentTrip, nextStatus)
      });

      if (!updatedTrip) {
        return updatedTrip;
      }

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
  );
};
