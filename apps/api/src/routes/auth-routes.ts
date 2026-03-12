import { apiError, mapPersistenceError } from "../errors.js";
import { created, requireSessionOrThrow } from "./helpers.js";
import type { AuthRoutesContext } from "./context.js";

export const registerAuthRoutes = (context: AuthRoutesContext) => {
  const {
    app,
    signInSchema,
    signUpSchema,
    refreshSessionSchema,
    requireSession,
    ensureProfileForSession,
    signInWithSupabase,
    signInLocally,
    signUpWithSupabase,
    signUpLocally,
    refreshSupabaseSession,
    refreshLocalSession,
    isSupabaseReady,
    getDriverProfile,
    getInternalUserProfile,
    getPassengerProfile,
    publishDirectoryRealtime
  } = context;

  app.post("/auth/sign-in", async (request) => {
    const parsedPayload = signInSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      apiError(400, "invalid_sign_in_payload");
    }

    const payload = parsedPayload.data as {
      email: string;
      password: string;
      role?: "passenger" | "driver" | "operator" | "admin";
    };

    try {
      const session = isSupabaseReady
        ? await signInWithSupabase(payload)
        : await signInLocally(payload);
      await ensureProfileForSession(session);
      return session;
    } catch (error) {
      apiError(
        error instanceof Error &&
          (error.message === "role_mismatch" || error.message === "account_inactive")
          ? 403
          : 401,
        error instanceof Error && error.message === "role_mismatch"
          ? "role_mismatch"
          : error instanceof Error && error.message === "account_inactive"
            ? "account_inactive"
            : "invalid_credentials"
      );
    }
  });

  app.post("/auth/sign-up", async (request, reply) => {
    const parsedPayload = signUpSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      apiError(400, "invalid_sign_up_payload");
    }

    const payload = parsedPayload.data as {
      email: string;
      password: string;
      fullName: string;
      phone: string;
      role: "passenger" | "driver" | "operator" | "admin";
    };

    try {
      const session = isSupabaseReady
        ? await signUpWithSupabase(payload)
        : await signUpLocally(payload);
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
          internalUserProfile:
            session.user.role === "operator" || session.user.role === "admin"
              ? (await getInternalUserProfile(session.user.id)) ?? undefined
              : undefined,
          passengerProfile:
            session.user.role === "passenger"
              ? (await getPassengerProfile(session.user.id)) ?? undefined
              : undefined
        }
      );
      return created(reply, session);
    } catch (error) {
      mapPersistenceError(error, {
        conflictCode: "sign_up_failed",
        fallbackCode: "sign_up_failed"
      });
    }
  });

  app.post("/auth/refresh", async (request) => {
    const parsedPayload = refreshSessionSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      apiError(400, "invalid_refresh_payload");
    }

    const payload = parsedPayload.data as {
      refreshToken: string;
    };

    try {
      const session = isSupabaseReady
        ? await refreshSupabaseSession(payload.refreshToken)
        : await refreshLocalSession(payload.refreshToken);
      const validSession = requireSessionOrThrow(session);

      await ensureProfileForSession(validSession);
      return validSession;
    } catch {
      apiError(401, "invalid_refresh_token");
    }
  });

  app.get("/auth/session", async (request) => {
    const session = requireSessionOrThrow(await requireSession(request.headers.authorization));
    await ensureProfileForSession(session);
    return session;
  });
};
