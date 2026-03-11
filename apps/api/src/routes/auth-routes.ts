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
    signUpWithSupabase,
    refreshSupabaseSession,
    isSupabaseReady,
    getDriverProfile,
    getPassengerProfile,
    publishDirectoryRealtime
  } = context;

  app.post("/auth/sign-in", async (request) => {
    const parsedPayload = signInSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      apiError(400, "invalid_sign_in_payload");
    }

    if (!isSupabaseReady) {
      apiError(503, "auth_unavailable");
    }

    const payload = parsedPayload.data as {
      email: string;
      password: string;
      role?: "passenger" | "driver" | "operator" | "admin";
    };

    try {
      const session = await signInWithSupabase(payload);
      await ensureProfileForSession(session);
      return session;
    } catch (error) {
      apiError(
        error instanceof Error && error.message === "role_mismatch" ? 403 : 401,
        error instanceof Error && error.message === "role_mismatch"
          ? "role_mismatch"
          : "invalid_credentials"
      );
    }
  });

  app.post("/auth/sign-up", async (request, reply) => {
    const parsedPayload = signUpSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      apiError(400, "invalid_sign_up_payload");
    }

    if (!isSupabaseReady) {
      apiError(503, "auth_unavailable");
    }

    const payload = parsedPayload.data as {
      email: string;
      password: string;
      fullName: string;
      phone: string;
      role: "passenger" | "driver" | "operator" | "admin";
    };

    try {
      const session = await signUpWithSupabase(payload);
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

    if (!isSupabaseReady) {
      apiError(400, "refresh_not_available");
    }

    const payload = parsedPayload.data as {
      refreshToken: string;
    };

    try {
      const session = await refreshSupabaseSession(payload.refreshToken);
      await ensureProfileForSession(session);
      return session;
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
