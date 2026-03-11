import type {
  CancelTripPayload,
  CreateIncidentPayload,
  RideEstimateRequest,
  RideTrip
} from "@diva-drive/domain";
import { apiError } from "../errors.js";
import { created, requireSessionOrThrow } from "./helpers.js";
import type { PassengerRoutesContext } from "./context.js";

export const registerPassengerRoutes = (context: PassengerRoutesContext) => {
  const {
    app,
    requireSession,
    requireRole,
    getPassengerActiveTrip,
    getDriverActiveTrip,
    getDriverQueue,
    getDriverProfileById,
    getRecentOperationalNotifications,
    defaultHomeBootstrap,
    rideEstimateSchema,
    estimateRide,
    createTripSchema,
    saveTrip,
    tripsById,
    createTripEvent,
    publishTripRealtime,
    publishTripTimelineRealtime,
    getTripHistoryForSession,
    getTripById,
    getTripTimeline,
    incidentSchema,
    saveIncident,
    incidentsById,
    cancelTripSchema,
    patchTrip
  } = context;

  app.get("/home/passenger", async (request) => {
    const session = requireSessionOrThrow(
      requireRole(await requireSession(request.headers.authorization), "passenger")
    );

    const activeTrip = await getPassengerActiveTrip(session.user.id);

    return {
      ...defaultHomeBootstrap,
      activeTripStatus: activeTrip?.status ?? null,
      notifications: await getRecentOperationalNotifications(session, activeTrip)
    };
  });

  app.get("/home/driver", async (request) => {
    const session = requireSessionOrThrow(
      requireRole(await requireSession(request.headers.authorization), "driver")
    );

    const activeTrip = await getDriverActiveTrip(session.user.id);
    const driverProfile = await getDriverProfileById(session.user.id);
    const isDriverOnline = driverProfile?.availabilityStatus === "online";

    return {
      city: defaultHomeBootstrap.city,
      queueSize: isDriverOnline ? (await getDriverQueue(session.user.id)).length : 0,
      activeTrip,
      driverProfile,
      notifications: await getRecentOperationalNotifications(session, activeTrip)
    };
  });

  app.post("/trips/estimate", async (request) => {
    const session = requireSessionOrThrow(
      requireRole(await requireSession(request.headers.authorization), "passenger")
    );

    const parsedPayload = rideEstimateSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      apiError(400, "invalid_estimate_payload");
    }

    return estimateRide(parsedPayload.data as RideEstimateRequest, session.user.id);
  });

  app.post("/trips", async (request, reply) => {
    const session = requireSessionOrThrow(
      requireRole(await requireSession(request.headers.authorization), "passenger")
    );

    const parsedPayload = createTripSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      apiError(400, "invalid_trip_payload");
    }

    const payload = parsedPayload.data as {
      passengerId: string;
      passengerName: string;
      origin: RideTrip["origin"];
      destination: RideTrip["destination"];
      promoCode?: string;
    };

    if (payload.passengerId !== session.user.id) {
      apiError(403, "passenger_mismatch");
    }

    const estimate = await estimateRide(payload as RideEstimateRequest, session.user.id);
    const persistedTrip = await saveTrip({
      id: `trip-${Date.now()}`,
      passengerId: payload.passengerId,
      passengerName: payload.passengerName,
      origin: payload.origin,
      destination: payload.destination,
      estimate,
      requestedPromoCode: payload.promoCode?.trim().toUpperCase(),
      status: "requested",
      requestedAt: new Date().toISOString()
    });

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
    return created(reply, persistedTrip);
  });

  app.get("/trips/active", async (request) => {
    const session = requireSessionOrThrow(await requireSession(request.headers.authorization));

    return {
      trip:
        session.user.role === "driver"
          ? await getDriverActiveTrip(session.user.id)
          : await getPassengerActiveTrip(session.user.id)
    };
  });

  app.get("/trips/history", async (request) => {
    const session = requireSessionOrThrow(await requireSession(request.headers.authorization));

    if (session.user.role !== "passenger" && session.user.role !== "driver") {
      apiError(403, "trip_history_not_available_for_role");
    }

    return getTripHistoryForSession(session);
  });

  app.get<{ Params: { tripId: string } }>("/trips/:tripId/events", async (request) => {
    const session = requireSessionOrThrow(await requireSession(request.headers.authorization));

      const trip = await getTripById(request.params.tripId);

      if (!trip) {
        apiError(404, "trip_not_found");
      }
      const currentTrip = trip as RideTrip;

      const canSeeTrip =
        session.user.role === "passenger"
          ? currentTrip.passengerId === session.user.id
          : session.user.role === "driver"
          ? currentTrip.driverId === session.user.id
          : true;

    if (!canSeeTrip) {
      apiError(403, "trip_events_not_allowed");
    }

      return getTripTimeline(currentTrip.id);
  });

  app.post<{ Body: CreateIncidentPayload }>("/incidents", async (request, reply) => {
    const session = requireSessionOrThrow(await requireSession(request.headers.authorization));

    const parsedPayload = incidentSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      apiError(400, "invalid_incident_payload");
    }

    const payload = parsedPayload.data as CreateIncidentPayload;
    const trip = await getTripById(payload.tripId);

    if (!trip) {
      apiError(404, "trip_not_found");
    }
    const currentTrip = trip as RideTrip;

    const persistedIncident = await saveIncident({
      id: `incident-${Date.now()}`,
      tripId: currentTrip.id,
      reporterRole: session.user.role === "driver" ? "driver" : "passenger",
      reporterId: session.user.id,
      severity: payload.severity,
      category: payload.category,
      notes: payload.notes,
      createdAt: new Date().toISOString(),
      status: "open"
    });

    incidentsById.set(persistedIncident.id, persistedIncident);
    const incidentEvent = await createTripEvent({
      tripId: currentTrip.id,
      type: "incident_created",
      occurredAt: persistedIncident.createdAt,
      actorId: session.user.id,
      actorRole: session.user.role,
      message: `Incidencia reportada por ${session.user.role}: ${persistedIncident.category}`
    });
    publishTripRealtime(currentTrip, "incident_created");
    publishTripTimelineRealtime(currentTrip, "incident_created", incidentEvent);
    return created(reply, persistedIncident);
  });

  app.post<{ Params: { tripId: string }; Body: CancelTripPayload }>(
    "/trips/:tripId/cancel",
    async (request) => {
      const session = requireSessionOrThrow(await requireSession(request.headers.authorization));

      const parsedPayload = cancelTripSchema.safeParse(request.body);

      if (!parsedPayload.success) {
        apiError(400, "invalid_cancel_payload");
      }

      const payload = parsedPayload.data as CancelTripPayload;
      const trip = await getTripById(request.params.tripId);

      if (!trip) {
        apiError(404, "trip_not_found");
      }
      const currentTrip = trip as RideTrip;

      const sessionCanCancel =
        session.user.role === "passenger"
          ? currentTrip.passengerId === session.user.id
          : currentTrip.driverId === session.user.id;

      if (!sessionCanCancel) {
        apiError(403, "trip_cancel_not_allowed");
      }

      const cancelledTrip = patchTrip(currentTrip.id, {
        status: "cancelled",
        cancellationReason: payload.reason,
        cancelledByRole: session.user.role === "driver" ? "driver" : "passenger",
        cancelledAt: new Date().toISOString(),
        driverEtaMinutes: undefined,
        currentDriverLocation: undefined
      });

      if (!cancelledTrip) {
        return cancelledTrip;
      }

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
  );
};
