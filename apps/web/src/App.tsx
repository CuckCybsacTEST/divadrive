import { useEffect, useState } from "react";
import {
  SERVICE_NAME,
  type OpsDashboardSnapshot,
  type RideTrip
} from "@diva-drive/domain";

const API_BASE_URL = "http://127.0.0.1:4000";

const emptySnapshot: OpsDashboardSnapshot = {
  queueTrips: [],
  activeTrips: [],
  completedTrips: [],
  totals: {
    requested: 0,
    active: 0,
    completed: 0
  }
};

const formatMoney = (trip: RideTrip) =>
  `${trip.estimate.currency} ${trip.estimate.estimatedFare.toFixed(2)}`;

export default function App() {
  const [snapshot, setSnapshot] = useState<OpsDashboardSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadDashboard = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/ops/dashboard`);

        if (!response.ok) {
          throw new Error("dashboard_unavailable");
        }

        const nextSnapshot =
          (await response.json()) as OpsDashboardSnapshot;

        if (mounted) {
          setSnapshot(nextSnapshot);
          setError(null);
        }
      } catch {
        if (mounted) {
          setError("No pudimos cargar el panel operativo.");
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
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Panel Operativo</p>
        <h1>{SERVICE_NAME}</h1>
        <p className="lede">
          Cola, viajes activos y completados desde un snapshot vivo del backend.
        </p>
      </section>

      <section className="stats">
        <article className="stat">
          <span>En cola</span>
          <strong>{snapshot.totals.requested}</strong>
        </article>
        <article className="stat">
          <span>Activos</span>
          <strong>{snapshot.totals.active}</strong>
        </article>
        <article className="stat">
          <span>Completados</span>
          <strong>{snapshot.totals.completed}</strong>
        </article>
      </section>

      {error ? <section className="banner error">{error}</section> : null}
      {loading ? <section className="banner">Cargando panel operativo...</section> : null}

      <section className="board">
        <article className="panel">
          <header className="panelHeader">
            <h2>Solicitudes</h2>
            <span>{snapshot.queueTrips.length}</span>
          </header>
          {snapshot.queueTrips.length === 0 ? (
            <p className="empty">No hay solicitudes pendientes.</p>
          ) : (
            snapshot.queueTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} accent="queue" />
            ))
          )}
        </article>

        <article className="panel">
          <header className="panelHeader">
            <h2>Activos</h2>
            <span>{snapshot.activeTrips.length}</span>
          </header>
          {snapshot.activeTrips.length === 0 ? (
            <p className="empty">No hay viajes activos.</p>
          ) : (
            snapshot.activeTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} accent="active" />
            ))
          )}
        </article>

        <article className="panel">
          <header className="panelHeader">
            <h2>Completados</h2>
            <span>{snapshot.completedTrips.length}</span>
          </header>
          {snapshot.completedTrips.length === 0 ? (
            <p className="empty">Aun no hay viajes completados.</p>
          ) : (
            snapshot.completedTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} accent="done" />
            ))
          )}
        </article>
      </section>
    </main>
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
      <p className="meta">{formatMoney(trip)} · {trip.estimate.durationMinutes} min</p>
      <p className="meta">Conductora: {trip.driverName ?? "Sin asignar"}</p>
      <p className="meta">Solicitado: {new Date(trip.requestedAt).toLocaleTimeString()}</p>
    </section>
  );
}
