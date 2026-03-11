import type { FastifyReply } from "fastify";

export const API_ERROR_CODES = [
  "auth_unavailable",
  "driver_already_has_active_trip",
  "driver_not_approved",
  "driver_not_found",
  "driver_profile_persistence_failed",
  "business_audit_persistence_failed",
  "driver_offline",
  "incident_not_found",
  "incident_persistence_failed",
  "internal_server_error",
  "invalid_cancel_payload",
  "invalid_credentials",
  "invalid_driver_approval_payload",
  "invalid_driver_availability_payload",
  "invalid_estimate_payload",
  "invalid_incident_payload",
  "invalid_incident_status_payload",
  "invalid_places_query",
  "invalid_promotion_payload",
  "invalid_pricing_payload",
  "invalid_refresh_payload",
  "invalid_refresh_token",
  "invalid_session",
  "invalid_sign_in_payload",
  "invalid_sign_up_payload",
  "invalid_trip_payload",
  "invalid_status_payload",
  "invalid_status_transition",
  "passenger_mismatch",
  "pricing_persistence_failed",
  "promotion_code_conflict",
  "promotion_not_found",
  "promotion_persistence_failed",
  "refresh_not_available",
  "role_mismatch",
  "sign_up_failed",
  "trip_cancel_not_allowed",
  "trip_events_not_allowed",
  "trip_history_not_available_for_role",
  "trip_not_available",
  "trip_not_found",
  "trip_not_found_for_driver",
  "trip_reserved_for_another_driver",
  "trip_persistence_failed"
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorResponse {
  error: ApiErrorCode;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const apiError = (statusCode: number, code: ApiErrorCode): never => {
  throw new ApiError(statusCode, code);
};

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

const getErrorCode = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === "string" ? candidate : null;
};

const getErrorMessage = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = (error as { message?: unknown }).message;
  return typeof candidate === "string" ? candidate : null;
};

export const isUniqueConstraintError = (error: unknown) => {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  return code === "23505" || /duplicate key value/i.test(message ?? "");
};

export const mapPersistenceError = (
  error: unknown,
  options: {
    conflictCode: ApiErrorCode;
    fallbackCode?: ApiErrorCode;
  }
): never => {
  if (isApiError(error)) {
    throw error;
  }

  if (isUniqueConstraintError(error)) {
    return apiError(409, options.conflictCode);
  }

  return apiError(500, options.fallbackCode ?? "internal_server_error");
};

export const sendApiError = (reply: FastifyReply, error: ApiErrorResponse, statusCode: number) => {
  reply.status(statusCode);
  return error;
};
