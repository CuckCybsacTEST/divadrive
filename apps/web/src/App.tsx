import {
  SERVICE_NAME,
  TRIP_EVENT_TYPES,
  TRIP_STATUSES
} from "@diva-drive/domain";

const pillars = [
  "Android first",
  "Seguridad operacional",
  "Mapa como viewport principal",
  "Negocio configurable"
];

export default function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Fase 0</p>
        <h1>{SERVICE_NAME}</h1>
        <p className="lede">
          Base del monorepo lista para iniciar producto, backend y panel con un
          contrato compartido de viajes.
        </p>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Pilares</h2>
          <ul>
            {pillars.map((pillar) => (
              <li key={pillar}>{pillar}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Estados del viaje</h2>
          <ul>
            {TRIP_STATUSES.map((status) => (
              <li key={status}>{status}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Eventos auditables</h2>
          <ul>
            {TRIP_EVENT_TYPES.map((eventType) => (
              <li key={eventType}>{eventType}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}

