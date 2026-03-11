import { TRIP_EVENT_TYPES, TRIP_STATUSES, type DriverApprovalUpdate, type IncidentStatusUpdate, type PricingConfigUpdate, type PromotionUpsertPayload } from "@diva-drive/domain";
import { SERVICE_NAME } from "@diva-drive/domain";
import type { DriverProfile, Promotion, TripIncident } from "@diva-drive/domain";
import { appEnv } from "../env.js";
import { apiError } from "../errors.js";
import { created, requireSessionOrThrow } from "./helpers.js";
import type { OpsRoutesContext } from "./context.js";

export const registerOpsRoutes = (context: OpsRoutesContext) => {
  const {
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
    getCommercialMetrics,
    getOpsEventStream,
    listDriverProfiles,
    listPassengerProfiles,
    hydrateDirectoryState,
    readTrips,
    hydrateTrip,
    readIncidents,
    hydrateIncident,
    incidentStatusSchema,
    incidentsById,
    getIncident,
    getTripById,
    saveIncident,
    publishTripRealtime,
    driverApprovalSchema,
    driverProfilesById,
    saveDriverProfile,
    publishDirectoryRealtime,
    pricingConfigSchema,
    savePricingConfig,
    setPricingConfig,
    appendBusinessAudit,
    appendBusinessAuditEntry,
    publishBusinessRealtime,
    getBusinessSnapshot,
    promotionSchema,
    savePromotion,
    promotionsById
  } = context;

  const requireOpsSession = async (authorizationHeader?: string) =>
    requireAnyRole(await requireSession(authorizationHeader), ["operator", "admin"]);

  app.get("/health", async () => ({
    service: SERVICE_NAME,
    status: "ok",
    supabaseEnabled: appEnv.supabaseEnabled,
    persistence: appEnv.supabaseEnabled ? "supabase" : "local_json"
  }));

  app.get("/meta/trips", async () => ({
    statuses: TRIP_STATUSES,
    events: TRIP_EVENT_TYPES
  }));

  app.get("/places/search", async (request) => {
    requireSessionOrThrow(
      await requireSession(request.headers.authorization),
    );
    const session = requireAnyRole(
      await requireSession(request.headers.authorization),
      ["passenger"]
    );
    if (!session) {
      apiError(401, "invalid_session");
    }

    const parsedQuery = placeSearchSchema.safeParse(request.query);

    if (!parsedQuery.success) {
      apiError(400, "invalid_places_query");
    }

    const query = parsedQuery.data as { query: string };
    const normalizedQuery = query.query.trim().toLowerCase();
    return {
      query: query.query,
      results: searchablePlaces
        .filter(
          (place) =>
            place.label.toLowerCase().includes(normalizedQuery) ||
            place.address.toLowerCase().includes(normalizedQuery)
        )
        .slice(0, 6)
    };
  });

  app.get("/ops/dashboard", async (request) => {
    requireSessionOrThrow(await requireOpsSession(request.headers.authorization));
    return getOpsSnapshot();
  });

  app.get("/ops/business", async (request) => {
    requireSessionOrThrow(await requireOpsSession(request.headers.authorization));
    return hydrateBusinessState({
      pricing: await getPricingConfig(),
      promotions: await listPromotions(),
      auditLog: await listBusinessAuditEntries()
    });
  });

  app.get("/ops/commercial-metrics", async (request) => {
    requireSessionOrThrow(await requireOpsSession(request.headers.authorization));
    return getCommercialMetrics();
  });

  app.get("/ops/events", async (request) => {
    requireSessionOrThrow(await requireOpsSession(request.headers.authorization));
    return { events: await getOpsEventStream() };
  });

  app.get("/ops/directory", async (request) => {
    requireSessionOrThrow(await requireOpsSession(request.headers.authorization));
    return hydrateDirectoryState({
      drivers: await listDriverProfiles(),
      passengers: await listPassengerProfiles()
    });
  });

  app.get("/ops/trips", async (request) => {
    requireSessionOrThrow(await requireOpsSession(request.headers.authorization));
    return {
      trips: (await readTrips())
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
        .map(hydrateTrip)
    };
  });

  app.get("/ops/incidents", async (request) => {
    requireSessionOrThrow(await requireOpsSession(request.headers.authorization));
    return {
      incidents: (await readIncidents())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(hydrateIncident)
    };
  });

  app.post<{ Params: { incidentId: string }; Body: IncidentStatusUpdate }>(
    "/ops/incidents/:incidentId/status",
    async (request) => {
      requireSessionOrThrow(await requireOpsSession(request.headers.authorization));

      const parsedPayload = incidentStatusSchema.safeParse(request.body);
      if (!parsedPayload.success) {
        apiError(400, "invalid_incident_status_payload");
      }

      const payload = parsedPayload.data as IncidentStatusUpdate;
      const incident =
        incidentsById.get(request.params.incidentId) ??
        (await getIncident(request.params.incidentId));
      if (!incident) {
        apiError(404, "incident_not_found");
      }
      const currentIncident = incident as TripIncident;

      const persistedIncident = await saveIncident({
        ...currentIncident,
        status: payload.status
      });
      incidentsById.set(persistedIncident.id, persistedIncident);

      const trip = await getTripById(persistedIncident.tripId);
      if (trip) {
        publishTripRealtime(trip, `incident_${persistedIncident.status}`);
      }

      return persistedIncident;
    }
  );

  app.post<{ Params: { driverId: string }; Body: DriverApprovalUpdate }>(
    "/ops/drivers/:driverId/approval",
    async (request) => {
      requireSessionOrThrow(await requireOpsSession(request.headers.authorization));

      const parsedPayload = driverApprovalSchema.safeParse(request.body);
      if (!parsedPayload.success) {
        apiError(400, "invalid_driver_approval_payload");
      }

      const payload = parsedPayload.data as DriverApprovalUpdate;
      const profile = driverProfilesById.get(request.params.driverId);
      if (!profile) {
        apiError(404, "driver_not_found");
      }
      const currentProfile = profile as DriverProfile;

      const persistedProfile = await saveDriverProfile({
        ...currentProfile,
        approvalStatus: payload.approvalStatus
      });
      driverProfilesById.set(persistedProfile.id, persistedProfile);
      publishDirectoryRealtime(
        "driver_approval_updated",
        { userIds: [persistedProfile.id] },
        { driverProfile: persistedProfile }
      );
      return persistedProfile;
    }
  );

  app.post<{ Body: PricingConfigUpdate }>("/ops/pricing", async (request) => {
    const session = requireSessionOrThrow(await requireOpsSession(request.headers.authorization));

    const parsedPayload = pricingConfigSchema.safeParse(request.body);
    if (!parsedPayload.success) {
      apiError(400, "invalid_pricing_payload");
    }

    const payload = parsedPayload.data as PricingConfigUpdate;
    const pricing = await savePricingConfig(payload);
    setPricingConfig(pricing);
    const auditEntry = appendBusinessAudit(
      session,
      "pricing_updated",
      `Pricing actualizado a base ${payload.currency} ${payload.baseFare.toFixed(2)} y surge ${payload.surgeMultiplier.toFixed(1)}x`
    );
    await appendBusinessAuditEntry(auditEntry);
    publishBusinessRealtime("pricing_updated", { pricing, auditEntry });
    return getBusinessSnapshot();
  });

  app.post<{ Body: PromotionUpsertPayload }>("/ops/promotions", async (request, reply) => {
    const session = requireSessionOrThrow(await requireOpsSession(request.headers.authorization));

    const parsedPayload = promotionSchema.safeParse(request.body);
    if (!parsedPayload.success) {
      apiError(400, "invalid_promotion_payload");
    }

    const payload = parsedPayload.data as PromotionUpsertPayload;
    const persistedPromotion: Promotion = await savePromotion({
      id: `promo-${Date.now()}`,
      createdAt: new Date().toISOString(),
      ...payload,
      code: payload.code.trim().toUpperCase()
    });
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
    return created(reply, persistedPromotion);
  });

  app.post<{ Params: { promotionId: string }; Body: PromotionUpsertPayload }>(
    "/ops/promotions/:promotionId",
    async (request) => {
      const session = requireSessionOrThrow(
        await requireOpsSession(request.headers.authorization)
      );

      const parsedPayload = promotionSchema.safeParse(request.body);
      if (!parsedPayload.success) {
        apiError(400, "invalid_promotion_payload");
      }

      const payload = parsedPayload.data as PromotionUpsertPayload;
      const promotion = promotionsById.get(request.params.promotionId);
      if (!promotion) {
        apiError(404, "promotion_not_found");
      }
      const currentPromotion = promotion as Promotion;

      const persistedPromotion: Promotion = await savePromotion({
        ...currentPromotion,
        ...payload,
        code: payload.code.trim().toUpperCase()
      });
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
};
