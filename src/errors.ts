import type { ErrorResponseBody } from "./types.js";

export interface ErrorInit {
  statusCode?: number;
  code?: string;
  body?: unknown;
  /** Seconds, from the Retry-After header. */
  retryAfter?: number;
  cause?: unknown;
}

/** Base class of every error raised by the SDK. */
export class ScrapeMapsAPIError extends Error {
  readonly statusCode: number | undefined;
  readonly code: string | undefined;
  readonly body: unknown;
  /** Seconds to wait, from the Retry-After header (429/503). */
  readonly retryAfter: number | undefined;

  constructor(message: string, init: ErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.statusCode = init.statusCode;
    this.code = init.code;
    this.body = init.body;
    this.retryAfter = init.retryAfter;
  }
}

/** The server could not be reached. */
export class APIConnectionError extends ScrapeMapsAPIError {}
/** The request timed out. */
export class APITimeoutError extends APIConnectionError {}
/** 400/422: invalid place identifier, cursor, location or parameters. */
export class InvalidRequestError extends ScrapeMapsAPIError {}
/** 401: missing or invalid API key (also thrown when no key is configured). */
export class AuthenticationError extends ScrapeMapsAPIError {}

/** 402: not enough credits. */
export class InsufficientCreditsError extends ScrapeMapsAPIError {
  get available(): number | undefined {
    return detailNumber(this.body, "available");
  }
  get required(): number | undefined {
    return detailNumber(this.body, "required");
  }
}

/** 404: the place does not exist. */
export class NotFoundError extends ScrapeMapsAPIError {}
/** 429: too many requests; see `retryAfter`. */
export class RateLimitError extends ScrapeMapsAPIError {}
/**
 * 429 `insufficient_credits_retry_later`: the key kept calling with no credits and is in a
 * cooldown. Top up credits. Never retried automatically.
 */
export class CreditsCooldownError extends RateLimitError {}
/** 502: Google Maps answered with an error. You were not charged. */
export class UpstreamError extends ScrapeMapsAPIError {}
/** 503: Google Maps is temporarily unreachable. You were not charged. */
export class ServiceUnavailableError extends UpstreamError {}
/** 500 and other unexpected 5xx responses. */
export class InternalServerError extends ScrapeMapsAPIError {}

type ErrorClass = new (message: string, init?: ErrorInit) => ScrapeMapsAPIError;

const CODE_MAP: Record<string, ErrorClass> = {
  invalid_place_id: InvalidRequestError,
  invalid_cursor: InvalidRequestError,
  invalid_location: InvalidRequestError,
  validation_error: InvalidRequestError,
  missing_api_key: AuthenticationError,
  invalid_api_key: AuthenticationError,
  insufficient_credits: InsufficientCreditsError,
  place_not_found: NotFoundError,
  rate_limited: RateLimitError,
  rate_limit_exceeded: RateLimitError,
  insufficient_credits_retry_later: CreditsCooldownError,
  upstream_error: UpstreamError,
  upstream_unavailable: ServiceUnavailableError,
};

const STATUS_MAP: Record<number, ErrorClass> = {
  400: InvalidRequestError,
  401: AuthenticationError,
  402: InsufficientCreditsError,
  404: NotFoundError,
  422: InvalidRequestError,
  429: RateLimitError,
  502: UpstreamError,
  503: ServiceUnavailableError,
};

function detailNumber(body: unknown, key: string): number | undefined {
  if (body && typeof body === "object") {
    const detail = (body as { detail?: unknown }).detail;
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const value = (detail as Record<string, unknown>)[key];
      if (typeof value === "number") return value;
    }
  }
  return undefined;
}

export function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
}

/** Extract `{code, message}` from an error body, whatever its shape. */
export function parseErrorBody(
  status: number,
  body: unknown,
  text = ""
): { code: string | undefined; message: string } {
  let code: string | undefined;
  let message = text.trim() || `HTTP ${status}`;
  if (body && typeof body === "object") {
    const b = body as ErrorResponseBody;
    const detail = b.detail ?? (b as ErrorResponseBody["detail"]);
    if (Array.isArray(detail)) {
      code = "validation_error";
      const msgs = detail.map((item) => {
        const loc = (item.loc ?? []).filter((p) => p !== "query" && p !== "path").join(".");
        const msg = item.msg ?? "invalid value";
        return loc ? `${loc}: ${msg}` : msg;
      });
      if (msgs.length) message = msgs.join("; ");
    } else if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail === "object") {
      if (typeof detail.error === "string") code = detail.error;
      if (typeof detail.message === "string") message = detail.message;
    }
  }
  return { code, message };
}

export function errorClassFor(status: number, code: string | undefined): ErrorClass {
  // 5xx: the status decides. A 5xx body can carry an upstream code such as "rate_limited"
  // (Google throttled us) that must not turn into a client-side RateLimitError.
  if (code && CODE_MAP[code] && status < 500) return CODE_MAP[code];
  if (STATUS_MAP[status]) return STATUS_MAP[status];
  if (status >= 500) return InternalServerError;
  return ScrapeMapsAPIError;
}

/** Build the typed error for a non-2xx response. */
export async function errorFromResponse(response: Response): Promise<ScrapeMapsAPIError> {
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  const { code, message } = parseErrorBody(response.status, body, body === undefined ? text : "");
  const ErrorCls = errorClassFor(response.status, code);
  return new ErrorCls(message, {
    statusCode: response.status,
    code,
    body,
    retryAfter: parseRetryAfter(response.headers),
  });
}
