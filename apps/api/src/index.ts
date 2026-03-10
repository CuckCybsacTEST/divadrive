import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  DEFAULT_HOME_BOOTSTRAP,
  SERVICE_NAME,
  type AuthSession,
  TRIP_EVENT_TYPES,
  TRIP_STATUSES
} from "@diva-drive/domain";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

const sessions = new Map<string, AuthSession>();
const signInSchema = z.object({
  phone: z.string().min(9),
  role: z.enum(["passenger", "driver"])
});

const createSession = (payload: z.infer<typeof signInSchema>): AuthSession => {
  const idSuffix = payload.phone.replace(/\D/g, "").slice(-4) || "0000";
  const session: AuthSession = {
    accessToken: `demo-${payload.role}-${idSuffix}`,
    user: {
      id: `${payload.role}-${idSuffix}`,
      role: payload.role,
      fullName:
        payload.role === "driver" ? "Conductora Demo" : "Pasajera Demo",
      phone: payload.phone
    }
  };

  sessions.set(session.accessToken, session);
  return session;
};

app.get("/health", async () => {
  return {
    service: SERVICE_NAME,
    status: "ok"
  };
});

app.get("/meta/trips", async () => {
  return {
    statuses: TRIP_STATUSES,
    events: TRIP_EVENT_TYPES
  };
});

app.post("/auth/sign-in", async (request, reply) => {
  const parsedPayload = signInSchema.safeParse(request.body);

  if (!parsedPayload.success) {
    reply.status(400);
    return {
      error: "invalid_sign_in_payload"
    };
  }

  return createSession(parsedPayload.data);
});

app.get("/auth/session", async (request, reply) => {
  const token = request.headers.authorization?.replace("Bearer ", "");

  if (!token || !sessions.has(token)) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return sessions.get(token);
});

app.get("/home/passenger", async (request, reply) => {
  const token = request.headers.authorization?.replace("Bearer ", "");

  if (!token || !sessions.has(token)) {
    reply.status(401);
    return {
      error: "invalid_session"
    };
  }

  return DEFAULT_HOME_BOOTSTRAP;
});

const start = async () => {
  try {
    await app.listen({
      host: "0.0.0.0",
      port: 4000
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
