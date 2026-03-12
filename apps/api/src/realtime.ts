import websocket from "@fastify/websocket";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { RawData, WebSocket } from "ws";
import type {
  AuthSession,
  RealtimeEnvelope,
  UserRole,
  RideTrip,
  TripTimelineEvent,
  DriverProfile,
  InternalUserProfile,
  PassengerProfile,
  PricingConfig,
  Promotion,
  BusinessAuditEntry
} from "@diva-drive/domain";

interface ClientRecord {
  socket: WebSocket;
  session: AuthSession;
}

interface PublishTargets {
  ops?: boolean;
  userIds?: string[];
  roles?: UserRole[];
}

export interface RealtimeHub {
  register(app: FastifyInstance): Promise<void>;
  publish(event: Omit<RealtimeEnvelope, "id" | "occurredAt">, targets: PublishTargets): void;
  close(): Promise<void>;
}

export interface SupabaseRealtimeBridge {
  start(): void;
  close(): Promise<void>;
}

const normalizeToken = (request: FastifyRequest) => {
  const query = request.query as Record<string, string | undefined>;
  const tokenFromQuery = query.token;
  const authorization = request.headers.authorization;
  const tokenFromHeader = authorization?.replace("Bearer ", "");
  return tokenFromQuery ?? tokenFromHeader ?? null;
};

const matchesTargets = (session: AuthSession, targets: PublishTargets) => {
  if (targets.ops && (session.user.role === "operator" || session.user.role === "admin")) {
    return true;
  }

  if (targets.userIds?.includes(session.user.id)) {
    return true;
  }

  if (targets.roles?.includes(session.user.role)) {
    return true;
  }

  return false;
};

const sendJson = (socket: WebSocket, payload: RealtimeEnvelope) => {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
};

export const createRealtimeHub = (
  resolveSession: (token: string) => Promise<AuthSession | null>
): RealtimeHub => {
  const clients = new Set<ClientRecord>();

  return {
    async register(app) {
      await app.register(websocket);

      app.get("/ws", { websocket: true }, async (socket, request) => {
        const token = normalizeToken(request);

        if (!token) {
          socket.close(4401, "missing_token");
          return;
        }

        const session = await resolveSession(token);

        if (!session) {
          socket.close(4401, "invalid_session");
          return;
        }

        const client: ClientRecord = {
          socket,
          session
        };

        clients.add(client);

        sendJson(socket, {
          id: randomUUID(),
          type: "session.ready",
          occurredAt: new Date().toISOString(),
          reason: "connected"
        });

        socket.on("message", (payload: RawData) => {
          const message = payload.toString();
          if (message === "ping" && socket.readyState === socket.OPEN) {
            socket.send("pong");
          }
        });

        socket.on("close", () => {
          clients.delete(client);
        });

        socket.on("error", () => {
          clients.delete(client);
        });
      });
    },

    publish(event, targets) {
      const payload: RealtimeEnvelope = {
        id: randomUUID(),
        occurredAt: new Date().toISOString(),
        ...event
      };

      for (const client of clients) {
        if (!matchesTargets(client.session, targets)) {
          continue;
        }

        sendJson(client.socket, payload);
      }
    },

    async close() {
      for (const client of clients) {
        try {
          client.socket.close(1000, "server_shutdown");
        } catch {
          // Ignore socket close failures during shutdown.
        }
      }

      clients.clear();
    }
  };
};

interface PostgresChangePayload {
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

export const createSupabaseRealtimeBridge = (options: {
  supabase: SupabaseClient<any, any, any> | null;
  schema: string;
  onTripChanged: (payload: {
    passengerId?: string;
    driverId?: string;
    tripId?: string;
    reason: string;
    trip?: RideTrip;
  }) => Promise<void> | void;
  onTripTimelineChanged: (payload: {
    passengerId?: string;
    driverId?: string;
    tripId?: string;
    reason: string;
    timelineEvent?: TripTimelineEvent;
    trip?: RideTrip;
  }) => Promise<void> | void;
  onDirectoryChanged: (payload: {
    userId?: string;
    reason: string;
    driverProfile?: DriverProfile;
    internalUserProfile?: InternalUserProfile;
    passengerProfile?: PassengerProfile;
  }) => Promise<void> | void;
  onBusinessChanged: (payload: {
    reason: string;
    pricing?: PricingConfig;
    promotion?: Promotion;
    auditEntry?: BusinessAuditEntry;
  }) => Promise<void> | void;
  resolveTripAudience: (
    tripId: string
  ) => Promise<{ passengerId?: string; driverId?: string; tripId?: string } | null>;
  resolveTrip: (tripId: string) => Promise<RideTrip | null>;
  resolveTimelineEvent: (eventId: string) => Promise<TripTimelineEvent | null>;
  resolveDriverProfile: (driverId: string) => Promise<DriverProfile | null>;
  resolveInternalUserProfile: (internalUserId: string) => Promise<InternalUserProfile | null>;
  resolvePassengerProfile: (passengerId: string) => Promise<PassengerProfile | null>;
  resolvePricing: () => Promise<PricingConfig>;
  resolvePromotion: (promotionId: string) => Promise<Promotion | null>;
  resolveBusinessAuditEntry: (entryId: string) => Promise<BusinessAuditEntry | null>;
}): SupabaseRealtimeBridge => {
  const channels: RealtimeChannel[] = [];

  const start = () => {
    if (!options.supabase) {
      return;
    }

    const subscribe = (table: string, handler: (payload: PostgresChangePayload) => void) => {
      const channel = options.supabase!
        .channel(`realtime:${table}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: options.schema,
            table
          },
          (payload) => {
            handler(payload as PostgresChangePayload);
          }
        )
        .subscribe();

      channels.push(channel);
    };

    subscribe("trips", (payload) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<
        string,
        unknown
      >;
      const tripId = typeof row.id === "string" ? row.id : undefined;
      if (!tripId) {
        return;
      }

      void options.resolveTrip(tripId).then((trip) => {
        void options.onTripChanged({
          passengerId:
            typeof row.passenger_id === "string" ? row.passenger_id : trip?.passengerId,
          driverId: typeof row.driver_id === "string" ? row.driver_id : trip?.driverId,
          tripId,
          reason: `supabase_trips_${payload.eventType.toLowerCase()}`,
          trip: payload.eventType === "DELETE" ? undefined : trip ?? undefined
        });
      });
    });

    subscribe("trip_events", (payload) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<
        string,
        unknown
      >;
      const eventId = typeof row.id === "string" ? row.id : undefined;
      const tripId = typeof row.trip_id === "string" ? row.trip_id : undefined;

      if (!tripId || !eventId) {
        return;
      }

      void Promise.all([
        options.resolveTripAudience(tripId),
        payload.eventType === "DELETE" ? Promise.resolve(null) : options.resolveTimelineEvent(eventId),
        payload.eventType === "DELETE" ? Promise.resolve(null) : options.resolveTrip(tripId)
      ]).then(([audience, timelineEvent, trip]) => {
        void options.onTripTimelineChanged({
          passengerId: audience?.passengerId,
          driverId: audience?.driverId,
          tripId,
          reason: `supabase_trip_events_${payload.eventType.toLowerCase()}`,
          timelineEvent: timelineEvent ?? undefined,
          trip: trip ?? undefined
        });
      });
    });

    subscribe("trip_incidents", (payload) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<
        string,
        unknown
      >;
      const tripId = typeof row.trip_id === "string" ? row.trip_id : undefined;

      if (!tripId) {
        return;
      }

      void Promise.all([
        options.resolveTripAudience(tripId),
        payload.eventType === "DELETE" ? Promise.resolve(null) : options.resolveTrip(tripId)
      ]).then(([audience, trip]) => {
        void options.onTripChanged({
          passengerId: audience?.passengerId,
          driverId: audience?.driverId,
          tripId,
          reason: `supabase_trip_incidents_${payload.eventType.toLowerCase()}`,
          trip: trip ?? undefined
        });
      });
    });

    subscribe("driver_profiles", (payload) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<
        string,
        unknown
      >;
      const userId = typeof row.id === "string" ? row.id : undefined;
      if (!userId) {
        return;
      }

      void (payload.eventType === "DELETE"
        ? Promise.resolve(null)
        : options.resolveDriverProfile(userId)
      ).then((driverProfile) => {
        void options.onDirectoryChanged({
          userId,
          reason: `supabase_driver_profiles_${payload.eventType.toLowerCase()}`,
          driverProfile: driverProfile ?? undefined
        });
      });
    });

    subscribe("passenger_profiles", (payload) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<
        string,
        unknown
      >;
      const userId = typeof row.id === "string" ? row.id : undefined;
      if (!userId) {
        return;
      }

      void (payload.eventType === "DELETE"
        ? Promise.resolve(null)
        : options.resolvePassengerProfile(userId)
      ).then((passengerProfile) => {
        void options.onDirectoryChanged({
          userId,
          reason: `supabase_passenger_profiles_${payload.eventType.toLowerCase()}`,
          passengerProfile: passengerProfile ?? undefined
        });
      });
    });

    subscribe("internal_user_profiles", (payload) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<
        string,
        unknown
      >;
      const userId = typeof row.id === "string" ? row.id : undefined;
      if (!userId) {
        return;
      }

      void (payload.eventType === "DELETE"
        ? Promise.resolve(null)
        : options.resolveInternalUserProfile(userId)
      ).then((internalUserProfile) => {
        void options.onDirectoryChanged({
          userId,
          reason: `supabase_internal_user_profiles_${payload.eventType.toLowerCase()}`,
          internalUserProfile: internalUserProfile ?? undefined
        });
      });
    });

    subscribe("business_config", (payload) => {
      void options.resolvePricing().then((pricing) => {
        void options.onBusinessChanged({
          reason: `supabase_business_config_${payload.eventType.toLowerCase()}`,
          pricing
        });
      });
    });

    subscribe("promotions", (payload) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<
        string,
        unknown
      >;
      const promotionId = typeof row.id === "string" ? row.id : undefined;

      if (!promotionId) {
        return;
      }

      void (payload.eventType === "DELETE"
        ? Promise.resolve(null)
        : options.resolvePromotion(promotionId)
      ).then((promotion) => {
        void options.onBusinessChanged({
          reason: `supabase_promotions_${payload.eventType.toLowerCase()}`,
          promotion: promotion ?? undefined
        });
      });
    });

    subscribe("business_audit_log", (payload) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Record<
        string,
        unknown
      >;
      const entryId = typeof row.id === "string" ? row.id : undefined;

      if (!entryId) {
        return;
      }

      void (payload.eventType === "DELETE"
        ? Promise.resolve(null)
        : options.resolveBusinessAuditEntry(entryId)
      ).then((auditEntry) => {
        void options.onBusinessChanged({
          reason: `supabase_business_audit_log_${payload.eventType.toLowerCase()}`,
          auditEntry: auditEntry ?? undefined
        });
      });
    });
  };

  return {
    start,
    async close() {
      if (!options.supabase) {
        return;
      }

      await Promise.all(channels.map((channel) => options.supabase!.removeChannel(channel)));
      channels.length = 0;
    }
  };
};
