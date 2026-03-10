import { type ReactNode, useEffect, useState } from "react";
import {
  type AdminDirectorySnapshot,
  SERVICE_NAME,
  type AuthSession,
  type DriverApprovalStatus,
  type IncidentStatus,
  type OpsDashboardSnapshot,
  type RideTrip
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const [nextSnapshot, nextDirectory] = await Promise.all([
          authorizedFetch<OpsDashboardSnapshot>(session, "/ops/dashboard"),
          authorizedFetch<AdminDirectorySnapshot>(session, "/ops/directory")
        ]);

        if (mounted) {
          setSnapshot(nextSnapshot);
          setDirectory(nextDirectory);
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
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
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
