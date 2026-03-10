import Fastify from "fastify";
import {
  SERVICE_NAME,
  TRIP_EVENT_TYPES,
  TRIP_STATUSES
} from "@diva-drive/domain";

const app = Fastify({
  logger: true
});

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

