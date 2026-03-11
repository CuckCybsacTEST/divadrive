import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  type BusinessRulesSnapshot,
  type AdminDirectorySnapshot,
  type CommercialMetricsSnapshot,
  type RealtimeEnvelope,
  SERVICE_NAME,
  type AuthSession,
  type DriverApprovalStatus,
  type IncidentStatus,
  type OpsDashboardSnapshot,
  type PricingConfig,
  type PromotionUpsertPayload,
  type RideTrip,
  type TripTimelineEvent
} from "@diva-drive/domain";

const API_BASE_URL = "http://127.0.0.1:4000";
const WS_BASE_URL = "ws://127.0.0.1:4000/ws";
const STORAGE_KEY = "diva-drive-ops-session";

type AuthMode = "sign_in" | "sign_up";
type WebRole = "operator" | "admin";
type RealtimePayload = RealtimeEnvelope & {
  trip?: RideTrip;
  timelineEvent?: TripTimelineEvent;
  driverProfile?: AdminDirectorySnapshot["drivers"][number];
  passengerProfile?: AdminDirectorySnapshot["passengers"][number];
  pricing?: PricingConfig;
  promotion?: BusinessRulesSnapshot["promotions"][number];
  auditEntry?: BusinessRulesSnapshot["auditLog"][number];
};

const emptySnapshot: OpsDashboardSnapshot = {
  queueTrips: [],
  activeTrips: [],
  completedTrips: [],
  cancelledTrips: [],
  incidents: [],
  totals: {
    requested: 0,
    active: 0,
    completed: 0,
    cancelled: 0,
    openIncidents: 0
  }
};

const emptyBusiness: BusinessRulesSnapshot = {
  pricing: {
    currency: "PEN",
    baseFare: 0,
    perKmRate: 0,
    perMinuteRate: 0,
    minimumFare: 0,
    serviceFee: 0,
    surgeMultiplier: 1
  },
  promotions: [],
  auditLog: []
};

const emptyCommercialMetrics: CommercialMetricsSnapshot = {
  totalRevenue: 0,
  totalDiscountAmount: 0,
  completedTrips: 0,
  cancelledTrips: 0,
  averageCompletedFare: 0,
  promoPerformance: []
};

const emptyEventStream: TripTimelineEvent[] = [];

const formatMoney = (trip: RideTrip) =>
  `${trip.estimate.currency} ${trip.estimate.estimatedFare.toFixed(2)}`;

const sortTrips = (trips: RideTrip[]) =>
  [...trips].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

const upsertTrip = (trips: RideTrip[], trip: RideTrip) =>
  sortTrips([trip, ...trips.filter((item) => item.id !== trip.id)]);

const patchSnapshotWithTrip = (
  current: OpsDashboardSnapshot,
  trip: RideTrip
): OpsDashboardSnapshot => {
  const queueTrips = trip.status === "requested"
    ? upsertTrip(current.queueTrips, trip)
    : current.queueTrips.filter((item) => item.id !== trip.id);
  const completedTrips = trip.status === "trip_completed"
    ? upsertTrip(current.completedTrips, trip)
    : current.completedTrips.filter((item) => item.id !== trip.id);
  const cancelledTrips = trip.status === "cancelled"
    ? upsertTrip(current.cancelledTrips, trip)
    : current.cancelledTrips.filter((item) => item.id !== trip.id);
  const isActiveTrip =
    trip.status !== "requested" &&
    trip.status !== "trip_completed" &&
    trip.status !== "cancelled";
  const activeTrips = isActiveTrip
    ? upsertTrip(current.activeTrips, trip)
    : current.activeTrips.filter((item) => item.id !== trip.id);

  return {
    ...current,
    queueTrips,
    activeTrips,
    completedTrips,
    cancelledTrips,
    totals: {
      ...current.totals,
      requested: queueTrips.length,
      active: activeTrips.length,
      completed: completedTrips.length,
      cancelled: cancelledTrips.length
    }
  };
};

const persistSession = (session: AuthSession | null) => {
  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
};

const parseStoredSession = () => {
  const savedSession = window.localStorage.getItem(STORAGE_KEY);

  if (!savedSession) {
    return null;
  }

  try {
    return JSON.parse(savedSession) as AuthSession;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("sign_in");
  const [email, setEmail] = useState("ops@divadrive.app");
  const [password, setPassword] = useState("DivaDrive123");
  const [fullName, setFullName] = useState("Operadora DIVA");
  const [phone, setPhone] = useState("999777111");
  const [role, setRole] = useState<WebRole>("operator");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [snapshot, setSnapshot] = useState<OpsDashboardSnapshot>(emptySnapshot);
  const [directory, setDirectory] = useState<AdminDirectorySnapshot>({
    drivers: [],
    passengers: []
  });
  const [business, setBusiness] = useState<BusinessRulesSnapshot>(emptyBusiness);
  const [commercialMetrics, setCommercialMetrics] =
    useState<CommercialMetricsSnapshot>(emptyCommercialMetrics);
  const [eventStream, setEventStream] = useState<TripTimelineEvent[]>(emptyEventStream);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pricingDraft, setPricingDraft] = useState<PricingConfig>(emptyBusiness.pricing);
  const [promotionDraft, setPromotionDraft] = useState<PromotionUpsertPayload>({
    name: "",
    code: "",
    kind: "percentage",
    audience: "new_passenger",
    applyMode: "automatic",
    value: 10,
    minFare: 12,
    description: "",
    isActive: true
  });
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const resourceTimersRef = useRef<Record<string, number | null>>({});
  const resourceInFlightRef = useRef(new Set<string>());
  const resourceQueuedRef = useRef(new Set<string>());

  useEffect(() => {
    const savedSession = parseStoredSession();
    setSession(savedSession);
    setLoading(savedSession !== null);
  }, []);

  const updateSession = (nextSession: AuthSession | null) => {
    setSession(nextSession);
    persistSession(nextSession);
  };

  const refreshSession = async (currentSession: AuthSession) => {
    if (!currentSession.refreshToken) {
      return null;
    }

    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        refreshToken: currentSession.refreshToken
      })
    });

    if (!response.ok) {
      updateSession(null);
      return null;
    }

    const nextSession = (await response.json()) as AuthSession;
    updateSession(nextSession);
    return nextSession;
  };

  const authorizedFetch = async <T,>(
    path: string,
    options?: RequestInit,
    sessionOverride?: AuthSession
  ): Promise<T> => {
    const baseSession = sessionOverride ?? session;

    if (!baseSession) {
      throw new Error("missing_session");
    }

    const doFetch = async (activeSession: AuthSession) =>
      fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.accessToken}`,
          ...(options?.headers ?? {})
        }
      });

    let activeSession = baseSession;
    let response = await doFetch(activeSession);

    if (response.status === 401) {
      const refreshedSession = await refreshSession(activeSession);

      if (!refreshedSession) {
        throw new Error("invalid_session");
      }

      activeSession = refreshedSession;
      response = await doFetch(activeSession);
    }

    if (!response.ok) {
      throw new Error(path);
    }

    return (await response.json()) as T;
  };

  const refreshResource = async (
    key: string,
    activeSession: AuthSession,
    loader: () => Promise<void>
  ) => {
    if (resourceInFlightRef.current.has(key)) {
      resourceQueuedRef.current.add(key);
      return;
    }

    resourceInFlightRef.current.add(key);
    try {
      await loader();
      setError(null);
    } catch {
      setError("No pudimos cargar el panel o la sesion ya no es valida.");
    } finally {
      resourceInFlightRef.current.delete(key);

      if (resourceQueuedRef.current.has(key)) {
        resourceQueuedRef.current.delete(key);
        void refreshResource(key, activeSession, loader);
      }
    }
  };

  const scheduleResourceRefresh = (
    key: string,
    activeSession: AuthSession,
    loader: () => Promise<void>
  ) => {
    const timer = resourceTimersRef.current[key];

    if (timer) {
      window.clearTimeout(timer);
    }

    resourceTimersRef.current[key] = window.setTimeout(() => {
      resourceTimersRef.current[key] = null;
      void refreshResource(key, activeSession, loader);
    }, 200);
  };

  const loadSnapshot = async (activeSession: AuthSession) => {
    const nextSnapshot = await authorizedFetch<OpsDashboardSnapshot>(
      "/ops/dashboard",
      undefined,
      activeSession
    );
    setSnapshot(nextSnapshot);
  };

  const loadDirectory = async (activeSession: AuthSession) => {
    const nextDirectory = await authorizedFetch<AdminDirectorySnapshot>(
      "/ops/directory",
      undefined,
      activeSession
    );
    setDirectory(nextDirectory);
  };

  const loadBusiness = async (activeSession: AuthSession) => {
    const nextBusiness = await authorizedFetch<BusinessRulesSnapshot>(
      "/ops/business",
      undefined,
      activeSession
    );
    setBusiness(nextBusiness);
    setPricingDraft(nextBusiness.pricing);
  };

  const loadCommercialMetrics = async (activeSession: AuthSession) => {
    const nextCommercialMetrics = await authorizedFetch<CommercialMetricsSnapshot>(
      "/ops/commercial-metrics",
      undefined,
      activeSession
    );
    setCommercialMetrics(nextCommercialMetrics);
  };

  const loadEventStream = async (activeSession: AuthSession) => {
    const nextEventStream = await authorizedFetch<{ events: TripTimelineEvent[] }>(
      "/ops/events",
      undefined,
      activeSession
    );
    setEventStream(nextEventStream.events);
  };

  const loadDashboard = async (activeSession: AuthSession, withLoading = false) => {
    if (withLoading) {
      setLoading(true);
    }

    try {
      await Promise.all([
        loadSnapshot(activeSession),
        loadDirectory(activeSession),
        loadBusiness(activeSession),
        loadCommercialMetrics(activeSession),
        loadEventStream(activeSession)
      ]);
      setError(null);
    } catch {
      setError("No pudimos cargar el panel o la sesion ya no es valida.");
    } finally {
      if (withLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }

    void loadDashboard(session, true);
  }, [session]);

  useEffect(() => {
    if (!session) {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    let cancelled = false;

    const connect = () => {
      const socket = new WebSocket(
        `${WS_BASE_URL}?token=${encodeURIComponent(session.accessToken)}`
      );
      socketRef.current = socket;

      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data) as RealtimePayload;

        if (payload.type === "session.ready") {
          return;
        }

        switch (payload.type) {
          case "ops.snapshot.refresh":
            if (payload.trip) {
              setSnapshot((current) => patchSnapshotWithTrip(current, payload.trip!));
              break;
            }
            scheduleResourceRefresh("snapshot", session, () => loadSnapshot(session));
            break;
          case "ops.directory.refresh":
            if (payload.driverProfile || payload.passengerProfile) {
              setDirectory((current) => ({
                drivers: payload.driverProfile
                  ? [...current.drivers.filter((item) => item.id !== payload.driverProfile!.id), payload.driverProfile]
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  : current.drivers,
                passengers: payload.passengerProfile
                  ? [
                      ...current.passengers.filter(
                        (item) => item.id !== payload.passengerProfile!.id
                      ),
                      payload.passengerProfile
                    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  : current.passengers
              }));
              break;
            }
            scheduleResourceRefresh("directory", session, () => loadDirectory(session));
            break;
          case "business.refresh":
            if (payload.pricing || payload.promotion || payload.auditEntry) {
              setBusiness((current) => ({
                pricing: payload.pricing ?? current.pricing,
                promotions: payload.promotion
                  ? [
                      payload.promotion,
                      ...current.promotions.filter((item) => item.id !== payload.promotion!.id)
                    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  : current.promotions,
                auditLog: payload.auditEntry
                  ? [payload.auditEntry, ...current.auditLog.filter((item) => item.id !== payload.auditEntry!.id)]
                      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                  : current.auditLog
              }));
              if (payload.pricing) {
                setPricingDraft(payload.pricing);
              }
              break;
            }
            scheduleResourceRefresh("business", session, () => loadBusiness(session));
            break;
          case "commercial.refresh":
            scheduleResourceRefresh("commercial", session, () => loadCommercialMetrics(session));
            break;
          case "ops.events.refresh":
            if (payload.timelineEvent) {
              setEventStream((current) =>
                [payload.timelineEvent!, ...current.filter((item) => item.id !== payload.timelineEvent!.id)]
                  .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                  .slice(0, 30)
              );
              break;
            }
            scheduleResourceRefresh("events", session, () => loadEventStream(session));
            break;
          default:
            break;
        }
      };

      socket.onclose = () => {
        if (cancelled) {
          return;
        }

        reconnectTimerRef.current = window.setTimeout(() => {
          connect();
        }, 1500);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      for (const timer of Object.values(resourceTimersRef.current)) {
        if (timer) {
          window.clearTimeout(timer);
        }
      }
      resourceTimersRef.current = {};
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [session]);

  const handleAuthSubmit = async () => {
    setLoading(true);
    try {
      const path = authMode === "sign_in" ? "/auth/sign-in" : "/auth/sign-up";
      const body =
        authMode === "sign_in"
          ? {
              email,
              password,
              role
            }
          : {
              email,
              password,
              fullName,
              phone,
              role
            };

      const nextSession = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("auth_failed");
        }

        return (await response.json()) as AuthSession;
      });

      updateSession(nextSession);
      setError(null);
    } catch {
      setError(
        authMode === "sign_in"
          ? "No pudimos iniciar sesion con esas credenciales."
          : "No pudimos crear la cuenta administrativa."
      );
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    updateSession(null);
    setSnapshot(emptySnapshot);
    setDirectory({
      drivers: [],
      passengers: []
    });
    setBusiness(emptyBusiness);
    setCommercialMetrics(emptyCommercialMetrics);
    setEventStream(emptyEventStream);
    setLoading(false);
  };

  const handleIncidentStatus = async (
    incidentId: string,
    status: IncidentStatus
  ) => {
    try {
      await authorizedFetch(`/ops/incidents/${incidentId}/status`, {
        method: "POST",
        body: JSON.stringify({ status })
      });

      const nextSnapshot = await authorizedFetch<OpsDashboardSnapshot>("/ops/dashboard");
      setSnapshot(nextSnapshot);
    } catch {
      setError("No pudimos actualizar la incidencia.");
    }
  };

  const handleDriverApproval = async (
    driverId: string,
    approvalStatus: DriverApprovalStatus
  ) => {
    try {
      await authorizedFetch(`/ops/drivers/${driverId}/approval`, {
        method: "POST",
        body: JSON.stringify({ approvalStatus })
      });

      const nextDirectory = await authorizedFetch<AdminDirectorySnapshot>("/ops/directory");
      setDirectory(nextDirectory);
    } catch {
      setError("No pudimos actualizar la aprobacion de la conductora.");
    }
  };

  const handlePricingChange = (field: keyof PricingConfig, value: string) => {
    setPricingDraft((current) => ({
      ...current,
      [field]: field === "currency" ? value.toUpperCase() : Number(value)
    }));
  };

  const handleSavePricing = async () => {
    try {
      const nextBusiness = await authorizedFetch<BusinessRulesSnapshot>("/ops/pricing", {
        method: "POST",
        body: JSON.stringify(pricingDraft)
      });
      setBusiness(nextBusiness);
      setPricingDraft(nextBusiness.pricing);
      setError(null);
    } catch {
      setError("No pudimos guardar la configuracion tarifaria.");
    }
  };

  const handleCreatePromotion = async () => {
    try {
      await authorizedFetch("/ops/promotions", {
        method: "POST",
        body: JSON.stringify({
          ...promotionDraft,
          code: promotionDraft.code.toUpperCase()
        })
      });

      const nextBusiness = await authorizedFetch<BusinessRulesSnapshot>("/ops/business");
      setBusiness(nextBusiness);
      setPromotionDraft({
        name: "",
        code: "",
        kind: "percentage",
        audience: "new_passenger",
        applyMode: "automatic",
        value: 10,
        minFare: 12,
        description: "",
        isActive: true
      });
    } catch {
      setError("No pudimos crear la promocion.");
    }
  };

  const handlePromotionToggle = async (
    promotionId: string,
    isActive: boolean
  ) => {
    const promotion = business.promotions.find((item) => item.id === promotionId);
    if (!promotion) {
      return;
    }

    try {
      await authorizedFetch(`/ops/promotions/${promotionId}`, {
        method: "POST",
        body: JSON.stringify({
          name: promotion.name,
          code: promotion.code,
          kind: promotion.kind,
          audience: promotion.audience,
          applyMode: promotion.applyMode,
          value: promotion.value,
          minFare: promotion.minFare,
          description: promotion.description,
          isActive
        } satisfies PromotionUpsertPayload)
      });
      const nextBusiness = await authorizedFetch<BusinessRulesSnapshot>("/ops/business");
      setBusiness(nextBusiness);
    } catch {
      setError("No pudimos actualizar la promocion.");
    }
  };

  if (!session) {
    return (
      <main className="shell">
        <section className="hero">
          <p className="eyebrow">Panel Seguro</p>
          <h1>{SERVICE_NAME}</h1>
          <p className="lede">
            Acceso administrativo real con Supabase Auth para operador o admin.
          </p>
        </section>

        <section className="panel authPanel">
          <h2>{authMode === "sign_in" ? "Iniciar sesion" : "Crear acceso"}</h2>
          <div className="roleSwitch">
            {(["operator", "admin"] as const).map((option) => (
              <button
                key={option}
                className={role === option ? "roleBtn active" : "roleBtn"}
                onClick={() => setRole(option)}
              >
                {option === "operator" ? "Operador" : "Admin"}
              </button>
            ))}
          </div>
          <div className="roleSwitch">
            {([
              { id: "sign_in", label: "Entrar" },
              { id: "sign_up", label: "Crear cuenta" }
            ] as const).map((option) => (
              <button
                key={option.id}
                className={authMode === option.id ? "roleBtn active" : "roleBtn"}
                onClick={() => setAuthMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {authMode === "sign_up" ? (
            <>
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Nombre completo"
                className="authInput"
              />
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="999777111"
                className="authInput"
              />
            </>
          ) : null}
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ops@divadrive.app"
            className="authInput"
            type="email"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Contrasena segura"
            className="authInput"
            type="password"
          />
          <button className="primaryAction" onClick={handleAuthSubmit}>
            {authMode === "sign_in" ? "Entrar al panel" : "Crear acceso"}
          </button>
          {error ? <p className="errorText">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="hero heroRow">
        <div>
          <p className="eyebrow">Panel Operativo</p>
          <h1>{SERVICE_NAME}</h1>
          <p className="lede">
            Cola, viajes e incidencias desde un dashboard protegido por sesion real.
          </p>
        </div>
        <div className="sessionBox">
          <p>{session.user.fullName}</p>
          <p>{session.user.role}</p>
          <p>{session.user.email}</p>
          <button className="secondaryAction" onClick={handleSignOut}>
            Cerrar sesion
          </button>
        </div>
      </section>

      <section className="stats">
        <StatCard label="En cola" value={snapshot.totals.requested} />
        <StatCard label="Activos" value={snapshot.totals.active} />
        <StatCard label="Completados" value={snapshot.totals.completed} />
        <StatCard label="Cancelados" value={snapshot.totals.cancelled} />
        <StatCard label="Incidencias abiertas" value={snapshot.totals.openIncidents} />
        <StatCard
          label="Revenue"
          value={`${business.pricing.currency} ${commercialMetrics.totalRevenue.toFixed(0)}`}
        />
        <StatCard
          label="Descuentos"
          value={`${business.pricing.currency} ${commercialMetrics.totalDiscountAmount.toFixed(0)}`}
        />
      </section>

      {error ? <section className="banner error">{error}</section> : null}
      {loading ? <section className="banner">Actualizando panel operativo...</section> : null}

      <section className="board">
        <Panel title="Solicitudes" count={snapshot.queueTrips.length}>
          {snapshot.queueTrips.length === 0 ? (
            <p className="empty">No hay solicitudes pendientes.</p>
          ) : (
            snapshot.queueTrips.map((trip) => <TripCard key={trip.id} trip={trip} accent="queue" />)
          )}
        </Panel>

        <Panel title="Activos" count={snapshot.activeTrips.length}>
          {snapshot.activeTrips.length === 0 ? (
            <p className="empty">No hay viajes activos.</p>
          ) : (
            snapshot.activeTrips.map((trip) => <TripCard key={trip.id} trip={trip} accent="active" />)
          )}
        </Panel>

        <Panel title="Completados" count={snapshot.completedTrips.length}>
          {snapshot.completedTrips.length === 0 ? (
            <p className="empty">Aun no hay viajes completados.</p>
          ) : (
            snapshot.completedTrips.map((trip) => <TripCard key={trip.id} trip={trip} accent="done" />)
          )}
        </Panel>

        <Panel title="Cancelados" count={snapshot.cancelledTrips.length}>
          {snapshot.cancelledTrips.length === 0 ? (
            <p className="empty">No hay viajes cancelados.</p>
          ) : (
            snapshot.cancelledTrips.map((trip) => <TripCard key={trip.id} trip={trip} accent="done" />)
          )}
        </Panel>
        <Panel title="Incidencias" count={snapshot.incidents.length}>
          {snapshot.incidents.length === 0 ? (
            <p className="empty">No hay incidencias registradas.</p>
          ) : (
            snapshot.incidents.map((incident) => (
              <section key={incident.id} className="tripCard queue">
                <div className="tripRow">
                  <strong>{incident.category}</strong>
                  <span className="badge">{incident.severity}</span>
                </div>
                <p className="meta">Trip: {incident.tripId}</p>
                <p className="meta">Reporta: {incident.reporterRole}</p>
                <p className="route">{incident.notes}</p>
                <div className="incidentActions">
                  {(["reviewing", "resolved"] as const).map((status) => (
                    <button
                      key={status}
                      className="secondaryAction"
                      onClick={() => handleIncidentStatus(incident.id, status)}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </Panel>

        <Panel title="Conductoras" count={directory.drivers.length}>
          {directory.drivers.length === 0 ? (
            <p className="empty">No hay conductoras registradas.</p>
          ) : (
            directory.drivers.map((driver) => (
              <section key={driver.id} className="tripCard active">
                <div className="tripRow">
                  <strong>{driver.fullName}</strong>
                  <span className="badge">{driver.approvalStatus}</span>
                </div>
                <p className="meta">{driver.phone}</p>
                <p className="meta">Licencia: {driver.licenseNumber}</p>
                <p className="meta">Vehiculo: {driver.vehicleDescription}</p>
                <div className="incidentActions">
                  {(["approved", "rejected"] as const).map((status) => (
                    <button
                      key={status}
                      className="secondaryAction"
                      onClick={() => handleDriverApproval(driver.id, status)}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </Panel>

        <Panel title="Pasajeros" count={directory.passengers.length}>
          {directory.passengers.length === 0 ? (
            <p className="empty">No hay pasajeros registrados.</p>
          ) : (
            directory.passengers.map((passenger) => (
              <section key={passenger.id} className="tripCard done">
                <div className="tripRow">
                  <strong>{passenger.fullName}</strong>
                  <span className="badge">passenger</span>
                </div>
                <p className="meta">{passenger.phone}</p>
                <p className="meta">Ciudad: {passenger.city}</p>
              </section>
            ))
          )}
        </Panel>

        <Panel title="Pricing" count={business.promotions.filter((item) => item.isActive).length}>
          <section className="formGrid">
            <label>
              <span>Moneda</span>
              <input
                className="authInput"
                value={pricingDraft.currency}
                onChange={(event) => handlePricingChange("currency", event.target.value)}
              />
            </label>
            <label>
              <span>Base</span>
              <input
                className="authInput"
                type="number"
                step="0.1"
                value={pricingDraft.baseFare}
                onChange={(event) => handlePricingChange("baseFare", event.target.value)}
              />
            </label>
            <label>
              <span>Por km</span>
              <input
                className="authInput"
                type="number"
                step="0.1"
                value={pricingDraft.perKmRate}
                onChange={(event) => handlePricingChange("perKmRate", event.target.value)}
              />
            </label>
            <label>
              <span>Por minuto</span>
              <input
                className="authInput"
                type="number"
                step="0.01"
                value={pricingDraft.perMinuteRate}
                onChange={(event) => handlePricingChange("perMinuteRate", event.target.value)}
              />
            </label>
            <label>
              <span>Minimo</span>
              <input
                className="authInput"
                type="number"
                step="0.1"
                value={pricingDraft.minimumFare}
                onChange={(event) => handlePricingChange("minimumFare", event.target.value)}
              />
            </label>
            <label>
              <span>Fee</span>
              <input
                className="authInput"
                type="number"
                step="0.1"
                value={pricingDraft.serviceFee}
                onChange={(event) => handlePricingChange("serviceFee", event.target.value)}
              />
            </label>
            <label>
              <span>Surge</span>
              <input
                className="authInput"
                type="number"
                step="0.1"
                value={pricingDraft.surgeMultiplier}
                onChange={(event) => handlePricingChange("surgeMultiplier", event.target.value)}
              />
            </label>
          </section>
          <button className="primaryAction" onClick={handleSavePricing}>
            Guardar pricing
          </button>
        </Panel>
        <Panel title="Promociones" count={business.promotions.length}>
          <section className="formGrid">
            <label>
              <span>Nombre</span>
              <input
                className="authInput"
                value={promotionDraft.name}
                onChange={(event) =>
                  setPromotionDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Codigo</span>
              <input
                className="authInput"
                value={promotionDraft.code}
                onChange={(event) =>
                  setPromotionDraft((current) => ({ ...current, code: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Tipo</span>
              <select
                className="authInput"
                value={promotionDraft.kind}
                onChange={(event) =>
                  setPromotionDraft((current) => ({
                    ...current,
                    kind: event.target.value as PromotionUpsertPayload["kind"]
                  }))
                }
              >
                <option value="percentage">Porcentaje</option>
                <option value="flat">Monto fijo</option>
              </select>
            </label>
            <label>
              <span>Audiencia</span>
              <select
                className="authInput"
                value={promotionDraft.audience}
                onChange={(event) =>
                  setPromotionDraft((current) => ({
                    ...current,
                    audience: event.target.value as PromotionUpsertPayload["audience"]
                  }))
                }
              >
                <option value="all">Todas</option>
                <option value="new_passenger">Nuevas pasajeras</option>
                <option value="returning_passenger">Pasajeras recurrentes</option>
              </select>
            </label>
            <label>
              <span>Modo</span>
              <select
                className="authInput"
                value={promotionDraft.applyMode}
                onChange={(event) =>
                  setPromotionDraft((current) => ({
                    ...current,
                    applyMode: event.target.value as PromotionUpsertPayload["applyMode"]
                  }))
                }
              >
                <option value="automatic">Automatica</option>
                <option value="code">Por codigo</option>
              </select>
            </label>
            <label>
              <span>Valor</span>
              <input
                className="authInput"
                type="number"
                step="0.1"
                value={promotionDraft.value}
                onChange={(event) =>
                  setPromotionDraft((current) => ({
                    ...current,
                    value: Number(event.target.value)
                  }))
                }
              />
            </label>
            <label>
              <span>Minimo</span>
              <input
                className="authInput"
                type="number"
                step="0.1"
                value={promotionDraft.minFare}
                onChange={(event) =>
                  setPromotionDraft((current) => ({
                    ...current,
                    minFare: Number(event.target.value)
                  }))
                }
              />
            </label>
            <label className="toggleLabel">
              <span>Activa</span>
              <input
                type="checkbox"
                checked={promotionDraft.isActive}
                onChange={(event) =>
                  setPromotionDraft((current) => ({
                    ...current,
                    isActive: event.target.checked
                  }))
                }
              />
            </label>
            <label className="fullWidth">
              <span>Descripcion</span>
              <input
                className="authInput"
                value={promotionDraft.description}
                onChange={(event) =>
                  setPromotionDraft((current) => ({
                    ...current,
                    description: event.target.value
                  }))
                }
              />
            </label>
          </section>
          <button className="primaryAction" onClick={handleCreatePromotion}>
            Crear promocion
          </button>
          <div className="promoList">
            {business.promotions.map((promotion) => (
              <section key={promotion.id} className="tripCard queue">
                <div className="tripRow">
                  <strong>{promotion.name}</strong>
                  <span className="badge">{promotion.code}</span>
                </div>
                <p className="meta">
                  {promotion.kind === "percentage"
                    ? `${promotion.value}%`
                    : `${business.pricing.currency} ${promotion.value.toFixed(2)}`}
                  {" - "}minimo {business.pricing.currency} {promotion.minFare.toFixed(2)}
                </p>
                <p className="meta">
                  {promotion.applyMode === "code" ? "Cupon manual" : "Autoaplica"} {" - "}
                  {promotion.audience}
                </p>
                <p className="route">{promotion.description}</p>
                <div className="incidentActions">
                  <button
                    className="secondaryAction"
                    onClick={() => handlePromotionToggle(promotion.id, !promotion.isActive)}
                  >
                    {promotion.isActive ? "Desactivar" : "Activar"}
                  </button>
                  <span className="badge">{promotion.isActive ? "active" : "paused"}</span>
                </div>
              </section>
            ))}
          </div>
        </Panel>

        <Panel title="Auditoria comercial" count={business.auditLog.length}>
          {business.auditLog.length === 0 ? (
            <p className="empty">Aun no hay cambios comerciales registrados.</p>
          ) : (
            business.auditLog.map((entry) => (
              <section key={entry.id} className="tripCard done">
                <div className="tripRow">
                  <strong>{entry.action}</strong>
                  <span className="badge">{entry.actorRole}</span>
                </div>
                <p className="route">{entry.summary}</p>
                <p className="meta">Actor: {entry.actorId}</p>
                <p className="meta">{new Date(entry.occurredAt).toLocaleString()}</p>
              </section>
            ))
          )}
        </Panel>
        <Panel title="Metricas comerciales" count={commercialMetrics.promoPerformance.length}>
          <section className="tripCard active">
            <p className="meta">
              Revenue total: {business.pricing.currency} {commercialMetrics.totalRevenue.toFixed(2)}
            </p>
            <p className="meta">
              Descuento total: {business.pricing.currency} {commercialMetrics.totalDiscountAmount.toFixed(2)}
            </p>
            <p className="meta">
              Ticket promedio completado: {business.pricing.currency} {commercialMetrics.averageCompletedFare.toFixed(2)}
            </p>
            <p className="meta">Viajes completados: {commercialMetrics.completedTrips}</p>
            <p className="meta">Viajes cancelados: {commercialMetrics.cancelledTrips}</p>
          </section>
          {commercialMetrics.promoPerformance.length === 0 ? (
            <p className="empty">Aun no hay promociones utilizadas.</p>
          ) : (
            commercialMetrics.promoPerformance.map((promo) => (
              <section key={promo.code} className="tripCard queue">
                <div className="tripRow">
                  <strong>{promo.code}</strong>
                  <span className="badge">{promo.uses} usos</span>
                </div>
                <p className="meta">
                  Descuento acumulado: {business.pricing.currency} {promo.totalDiscountAmount.toFixed(2)}
                </p>
              </section>
            ))
          )}
        </Panel>

        <Panel title="Feed operativo" count={eventStream.length}>
          {eventStream.length === 0 ? (
            <p className="empty">Aun no hay eventos operativos.</p>
          ) : (
            eventStream.map((event) => (
              <section key={event.id} className="tripCard active">
                <div className="tripRow">
                  <strong>{event.type}</strong>
                  <span className="badge">{event.actorRole ?? "system"}</span>
                </div>
                <p className="route">{event.message}</p>
                <p className="meta">Trip: {event.tripId}</p>
                <p className="meta">{new Date(event.occurredAt).toLocaleString()}</p>
              </section>
            ))
          )}
        </Panel>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <article className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({
  title,
  count,
  children
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <article className="panel">
      <header className="panelHeader">
        <h2>{title}</h2>
        <span>{count}</span>
      </header>
      {children}
    </article>
  );
}

function TripCard({
  trip,
  accent
}: {
  trip: RideTrip;
  accent: "queue" | "active" | "done";
}) {
  return (
    <section className={`tripCard ${accent}`}>
      <div className="tripRow">
        <strong>{trip.passengerName}</strong>
        <span className="badge">{trip.status}</span>
      </div>
      <p className="route">
        {trip.origin.label} {"->"} {trip.destination.label}
      </p>
      <p className="meta">{formatMoney(trip)} - {trip.estimate.durationMinutes} min</p>
      <p className="meta">Conductora: {trip.driverName ?? "Sin asignar"}</p>
      <p className="meta">Solicitado: {new Date(trip.requestedAt).toLocaleTimeString()}</p>
    </section>
  );
}
