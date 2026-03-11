import type { FastifyReply } from "fastify";
import type { AuthSession } from "@diva-drive/domain";
import { apiError } from "../errors.js";
import { applyCreated } from "../observability.js";

export const requireSessionOrThrow = <T extends AuthSession>(
  session: T | null | undefined
): T => {
  if (!session) {
    apiError(401, "invalid_session");
  }

  return session as T;
};

export const created = <T>(reply: FastifyReply, payload: T) => applyCreated(reply, payload);
