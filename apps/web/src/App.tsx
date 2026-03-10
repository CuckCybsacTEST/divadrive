import { type ReactNode, useEffect, useState } from "react";
import {
  type BusinessRulesSnapshot,
  type AdminDirectorySnapshot,
  type CommercialMetricsSnapshot,
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
const STORAGE_KEY = "diva-drive-ops-session";

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

const authorizedFetch = async <T,>(
  session: AuthSession,
  path: string,
  options?: RequestInit
) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...(options?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(path);
  }

  return (await response.json()) as T;
};

export default function App() {
  const [phone, setPhone] = useState("999777111");
  const [role, setRole] = useState<"operator" | "admin">("operator");
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

  useEffect(() => {
    const savedSession = window.localStorage.getItem(STORAGE_KEY);
    if (!savedSession) {
      setLoading(false);
      return;
    }

    try {
      const parsed = JSON.parse(savedSession) as AuthSession;
      setSession(parsed);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    let mounted = true;

    const loadDashboard = async () => {
      try {
        const [nextSnapshot, nextDirectory, nextBusiness, nextCommercialMetrics, nextEventStream] =
          await Promise.all([
          authorizedFetch<OpsDashboardSnapshot>(session, "/ops/dashboard"),
          authorizedFetch<AdminDirectorySnapshot>(session, "/ops/directory"),
          authorizedFetch<BusinessRulesSnapshot>(session, "/ops/business"),
          authorizedFetch<CommercialMetricsSnapshot>(session, "/ops/commercial-metrics"),
          authorizedFetch<{ events: TripTimelineEvent[] }>(session, "/ops/events")
        ]);

        if (mounted) {
          setSnapshot(nextSnapshot);
          setDirectory(nextDirectory);
          setBusiness(nextBusiness);
          setCommercialMetrics(nextCommercialMetrics);
          setEventStream(nextEventStream.events);
          setPricingDraft(nextBusiness.pricing);
          setError(null);
        }
      } catch {
        if (mounted) {
          setError("No pudimos cargar el panel o la sesion vencio.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadDashboard();
    const interval = setInterval(() => {
      void loadDashboard();
    }, 4000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [session]);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      const nextSession = await fetch(`${API_BASE_URL}/auth/sign-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone,
          role
        })
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("sign_in_failed");
        }
        return (await response.json()) as AuthSession;
      });

      setSession(nextSession);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
      setError(null);
    } catch {
      setError("No pudimos iniciar sesion en el panel.");
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setSnapshot(emptySnapshot);
    setLoading(false);
  };

  const handleIncidentStatus = async (
    incidentId: string,
    status: IncidentStatus
  ) => {
    if (!session) {
      return;
    }

    try {
      await authorizedFetch(session, `/ops/incidents/${incidentId}/status`, {
        method: "POST",
        body: JSON.stringify({ status })
      });

      const nextSnapshot = await authorizedFetch<OpsDashboardSnapshot>(
        session,
        "/ops/dashboard"
      );
      setSnapshot(nextSnapshot);
    } catch {
      setError("No pudimos actualizar la incidencia.");
    }
  };

  const handleDriverApproval = async (
    driverId: string,
    approvalStatus: DriverApprovalStatus
  ) => {
    if (!session) {
      return;
    }

    try {
      await authorizedFetch(session, `/ops/drivers/${driverId}/approval`, {
        method: "POST",
        body: JSON.stringify({ approvalStatus })
      });

      const nextDirectory = await authorizedFetch<AdminDirectorySnapshot>(
        session,
        "/ops/directory"
      );
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
    if (!session) {
      return;
    }

    try {
      const nextBusiness = await authorizedFetch<BusinessRulesSnapshot>(session, "/ops/pricing", {
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
    if (!session) {
      return;
    }

    try {
      await authorizedFetch(session, "/ops/promotions", {
        method: "POST",
        body: JSON.stringify({
          ...promotionDraft,
          code: promotionDraft.code.toUpperCase()
        })
      });
      const nextBusiness = await authorizedFetch<BusinessRulesSnapshot>(
        session,
        "/ops/business"
      );
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
    if (!session) {
      return;
    }

    const promotion = business.promotions.find((item) => item.id === promotionId);
    if (!promotion) {
      return;
    }

    try {
      await authorizedFetch(session, `/ops/promotions/${promotionId}`, {
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
      const nextBusiness = await authorizedFetch<BusinessRulesSnapshot>(
        session,
        "/ops/business"
      );
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
            Acceso administrativo para operador o admin antes de ver la operacion.
          </p>
        </section>

        <section className="panel authPanel">
          <h2>Iniciar sesion</h2>
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
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="999777111"
            className="authInput"
          />
          <button className="primaryAction" onClick={handleSignIn}>
            Entrar al panel
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
            Cola, viajes e incidencias desde un dashboard protegido por sesion.
          </p>
        </div>
        <div className="sessionBox">
          <p>{session.user.fullName}</p>
          <p>{session.user.role}</p>
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
            snapshot.queueTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} accent="queue" />
            ))
          )}
        </Panel>

        <Panel title="Activos" count={snapshot.activeTrips.length}>
          {snapshot.activeTrips.length === 0 ? (
            <p className="empty">No hay viajes activos.</p>
          ) : (
            snapshot.activeTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} accent="active" />
            ))
          )}
        </Panel>

        <Panel title="Completados" count={snapshot.completedTrips.length}>
          {snapshot.completedTrips.length === 0 ? (
            <p className="empty">Aun no hay viajes completados.</p>
          ) : (
            snapshot.completedTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} accent="done" />
            ))
          )}
        </Panel>

        <Panel title="Cancelados" count={snapshot.cancelledTrips.length}>
          {snapshot.cancelledTrips.length === 0 ? (
            <p className="empty">No hay viajes cancelados.</p>
          ) : (
            snapshot.cancelledTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} accent="done" />
            ))
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
                <p className="meta">
                  {new Date(entry.occurredAt).toLocaleString()}
                </p>
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
