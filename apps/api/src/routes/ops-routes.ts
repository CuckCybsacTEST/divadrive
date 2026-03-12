import { TRIP_EVENT_TYPES, TRIP_STATUSES, type DriverApprovalUpdate, type DriverOperationalUpdate, type IncidentStatusUpdate, type InternalUserCreatePayload, type InternalUserProfile, type InternalUserStatusUpdate, type OperationalZoneUpsertPayload, type PricingConfigUpdate, type PromotionUpsertPayload } from "@diva-drive/domain";
import { SERVICE_NAME } from "@diva-drive/domain";
import type { AuthSession, DriverProfile, Promotion, TripIncident } from "@diva-drive/domain";
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
    listOperationalZones,
    getCommercialMetrics,
    getOpsEventStream,
    listDriverProfiles,
    listInternalUserProfiles,
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
    driverOperationalSchema,
    internalUserCreateSchema,
    internalUserStatusSchema,
    driverProfilesById,
    internalUserProfilesById,
    saveDriverProfile,
    saveInternalUserProfile,
    createInternalUserAccount,
    getInternalUserProfile,
    updateInternalUserAuthStatus,
    publishDirectoryRealtime,
    pricingConfigSchema,
    savePricingConfig,
    setPricingConfig,
    zoneConfigSchema,
    setOperationalZones,
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

  const requireAdminSession = (session: AuthSession) => {
    if (session.user.role !== "admin") {
      apiError(403, "role_mismatch");
    }

    return session;
  };

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
      operationalZones: await listOperationalZones(),
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
      passengers: await listPassengerProfiles(),
      internalUsers: await listInternalUserProfiles()
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
      const session = requireSessionOrThrow(await requireOpsSession(request.headers.authorization));

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
      const reviewedAt = new Date().toISOString();

      const persistedProfile = await saveDriverProfile({
        ...currentProfile,
        approvalStatus: payload.approvalStatus,
        reviewedAt,
        reviewedBy: session.user.id
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

  app.post<{ Params: { driverId: string }; Body: DriverOperationalUpdate }>(
    "/ops/drivers/:driverId/operations",
    async (request) => {
      const session = requireSessionOrThrow(
        await requireOpsSession(request.headers.authorization)
      );

      const parsedPayload = driverOperationalSchema.safeParse(request.body);
      if (!parsedPayload.success) {
        apiError(400, "invalid_driver_operational_payload");
      }

      const payload = parsedPayload.data as DriverOperationalUpdate;
      const profile = driverProfilesById.get(request.params.driverId);
      if (!profile) {
        apiError(404, "driver_not_found");
      }
      const currentProfile = profile as DriverProfile;
      const nextReviewNotes =
        typeof payload.reviewNotes === "string" && payload.reviewNotes.trim().length > 0
          ? payload.reviewNotes.trim()
          : undefined;

      const persistedProfile = await saveDriverProfile({
        ...currentProfile,
        operationalStatus: payload.operationalStatus,
        availabilityStatus:
          payload.operationalStatus === "blocked"
            ? "offline"
            : currentProfile.availabilityStatus ?? "offline",
        reviewNotes: nextReviewNotes,
        reviewedAt: new Date().toISOString(),
        reviewedBy: session.user.id
      });
      driverProfilesById.set(persistedProfile.id, persistedProfile);
      publishDirectoryRealtime(
        "driver_operational_status_updated",
        { userIds: [persistedProfile.id] },
        { driverProfile: persistedProfile }
      );
      return persistedProfile;
    }
  );

  app.post<{ Body: InternalUserCreatePayload }>("/ops/internal-users", async (request, reply) => {
    const session = requireAdminSession(
      requireSessionOrThrow(await requireOpsSession(request.headers.authorization))
    );

    const parsedPayload = internalUserCreateSchema.safeParse(request.body);
    if (!parsedPayload.success) {
      apiError(400, "invalid_internal_user_payload");
    }

    const payload = parsedPayload.data as InternalUserCreatePayload;
    const authSession = await createInternalUserAccount(payload);
    const persistedProfile = await saveInternalUserProfile({
      id: authSession.user.id,
      role: authSession.user.role as InternalUserProfile["role"],
      fullName: authSession.user.fullName,
      phone: authSession.user.phone,
      email: authSession.user.email,
      city: "Lima",
      isActive: true,
      createdAt: new Date().toISOString()
    });
    internalUserProfilesById.set(persistedProfile.id, persistedProfile);
    publishDirectoryRealtime(
      "internal_user_created",
      { userIds: [persistedProfile.id] },
      { internalUserProfile: persistedProfile }
    );
    await appendBusinessAuditEntry(
      appendBusinessAudit(
        session,
        "promotion_created",
        `Usuario interno ${persistedProfile.email} creado con rol ${persistedProfile.role}`
      )
    );

    return created(reply, persistedProfile);
  });

  app.post<{ Params: { internalUserId: string }; Body: InternalUserStatusUpdate }>(
    "/ops/internal-users/:internalUserId/status",
    async (request) => {
      requireAdminSession(
        requireSessionOrThrow(await requireOpsSession(request.headers.authorization))
      );

      const parsedPayload = internalUserStatusSchema.safeParse(request.body);
      if (!parsedPayload.success) {
        apiError(400, "invalid_status_payload");
      }

      const payload = parsedPayload.data as InternalUserStatusUpdate;
      const profile = internalUserProfilesById.get(request.params.internalUserId);

      if (!profile) {
        apiError(404, "internal_user_not_found");
      }

      const persistedProfile = await saveInternalUserProfile({
        ...(profile as InternalUserProfile),
        isActive: payload.isActive
      });
      internalUserProfilesById.set(persistedProfile.id, persistedProfile);
      await updateInternalUserAuthStatus(persistedProfile.id, payload.isActive);
      publishDirectoryRealtime(
        "internal_user_status_updated",
        { userIds: [persistedProfile.id] },
        { internalUserProfile: persistedProfile }
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

  app.post<{ Body: OperationalZoneUpsertPayload }>("/ops/zones", async (request) => {
    const session = requireSessionOrThrow(await requireOpsSession(request.headers.authorization));

    const parsedPayload = zoneConfigSchema.safeParse(request.body);
    if (!parsedPayload.success) {
      apiError(400, "invalid_zone_payload");
    }

    const payload = parsedPayload.data as OperationalZoneUpsertPayload;
    await setOperationalZones(payload.operationalZones);
    const auditEntry = appendBusinessAudit(
      session,
      "zones_updated",
      `Zonas operativas actualizadas: ${payload.operationalZones.filter((zone) => zone.isActive).length} activas`
    );
    await appendBusinessAuditEntry(auditEntry);
    publishBusinessRealtime("zones_updated", { auditEntry });
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
