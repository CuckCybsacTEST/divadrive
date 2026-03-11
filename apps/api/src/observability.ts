import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    requestStartedAt?: number;
  }
}

export const applyCreated = <T>(reply: FastifyReply, payload: T) => {
  reply.status(201);
  return payload;
};

export const registerRequestObservability = (app: FastifyInstance) => {
  app.addHook("onRequest", async (request) => {
    request.requestStartedAt = Date.now();
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const durationMs = Date.now() - (request.requestStartedAt ?? Date.now());
    request.log.info(
      {
        requestId: request.id,
        route: request.routeOptions.url ?? request.url,
        statusCode: reply.statusCode,
        durationMs
      },
      "request_observed"
    );
  });
};
