import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** gRPC status codes (google.rpc.Code). */
export const GrpcCode = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
} as const;

export type GrpcCodeNumber = (typeof GrpcCode)[keyof typeof GrpcCode];

export function httpStatusForGrpcCode(code: number): number {
  switch (code) {
    case GrpcCode.INVALID_ARGUMENT:
    case GrpcCode.FAILED_PRECONDITION:
    case GrpcCode.OUT_OF_RANGE:
      return 400;
    case GrpcCode.UNAUTHENTICATED:
      return 401;
    case GrpcCode.PERMISSION_DENIED:
      return 403;
    case GrpcCode.NOT_FOUND:
      return 404;
    case GrpcCode.ALREADY_EXISTS:
    case GrpcCode.ABORTED:
      return 409;
    case GrpcCode.UNIMPLEMENTED:
      return 501;
    case GrpcCode.UNAVAILABLE:
      return 503;
    case GrpcCode.INTERNAL:
    case GrpcCode.DATA_LOSS:
    case GrpcCode.UNKNOWN:
    default:
      return code === GrpcCode.OK ? 200 : 500;
  }
}

export function jsonError(
  c: Context,
  code: GrpcCodeNumber,
  message: string,
  details?: unknown,
): Response {
  const status = httpStatusForGrpcCode(code);
  const body: Record<string, unknown> = { code, message };
  if (details !== undefined) body.details = details;
  return c.json(body, status as ContentfulStatusCode);
}
