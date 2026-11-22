import {
  APIConnectionError,
  APITimeoutError,
  AuthenticationError,
  ScrapeMapsAPIError,
  errorFromResponse,
} from "./errors.js";
import { PlacesAPI } from "./resources/places.js";
import type { ClientOptions, ResponseInfo } from "./types.js";

export const VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://api.scrapemapsapi.com";
export const DEFAULT_TIMEOUT = 60_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_BACKOFF = 500;
export const DEFAULT_MAX_RETRY_WAIT = 30_000;

const RETRY_STATUSES = new Set([429, 502, 503]);
// A 429 from the no-credit cooldown lasts minutes and only a top-up lifts it: never retried.
const NO_RETRY_CODES = new Set(["insufficient_credits_retry_later"]);

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/** @internal Raw result passed to the resources. */
export interface RawResult {
  body: Record<string, unknown>;
  info: ResponseInfo;
}

function env(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name] || undefined;
}

function headerInt(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

export function responseInfo(headers: Headers): ResponseInfo {
  return {
    creditsUsed: headerInt(headers, "x-credits-used"),
    creditsRemaining: headerInt(headers, "x-credits-remaining"),
    cache: headers.get("x-cache"),
    processingTimeMs: headerInt(headers, "x-processing-time"),
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Client for the ScrapeMapsAPI API (Google Maps places and reviews).
 *
 * ```ts
 * const client = new ScrapeMapsAPI(); // reads SCRAPEMAPSAPI_API_KEY
 * const { data } = await client.places.search({ q: "pizzeria in Naples", limit: 5 });
 * for await (const review of client.places.iterReviews(data[0].ids.cid, { maxItems: 50 })) { ... }
 * ```
 */
export class ScrapeMapsAPI {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly maxRetries: number;
  readonly retryBackoff: number;
  readonly maxRetryWait: number;
  readonly places: PlacesAPI;

  /** Billing headers of the last successful response (null before the first call). */
  lastResponseInfo: ResponseInfo | null = null;

  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #headers: Record<string, string>;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey || env("SCRAPEMAPSAPI_API_KEY");
    if (!apiKey) {
      throw new AuthenticationError(
        "No API key: pass { apiKey } or set the SCRAPEMAPSAPI_API_KEY environment variable."
      );
    }
    this.#apiKey = apiKey;
    this.baseUrl = (options.baseUrl || env("SCRAPEMAPSAPI_BASE_URL") || DEFAULT_BASE_URL).replace(
      /\/+$/,
      ""
    );
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryBackoff = Math.max(0, options.retryBackoff ?? DEFAULT_RETRY_BACKOFF);
    this.maxRetryWait = Math.max(0, options.maxRetryWait ?? DEFAULT_MAX_RETRY_WAIT);
    const f = options.fetch ?? globalThis.fetch;
    if (!f) throw new ScrapeMapsAPIError("No fetch implementation available: pass { fetch }.");
    this.#fetch = f.bind(globalThis);
    this.#sleep = options.sleep ?? defaultSleep;

    const headers: Record<string, string> = {
      "X-API-Key": this.#apiKey,
      Accept: "application/json",
    };
    // Browsers forbid/ignore User-Agent; only set it on servers.
    if (typeof (globalThis as { window?: unknown }).window === "undefined") {
      headers["User-Agent"] = `scrapemapsapi-js/${VERSION}`;
    }
    this.#headers = { ...headers, ...(options.headers ?? {}) };
    this.places = new PlacesAPI(this);
  }

  /** Credits left after the last successful call, or null. */
  get creditsRemaining(): number | null {
    return this.lastResponseInfo?.creditsRemaining ?? null;
  }

  #backoff(attempt: number): number {
    const base = Math.min(this.retryBackoff * 2 ** attempt, this.maxRetryWait);
    return base * (0.5 + Math.random() / 2);
  }

  /** @internal GET a path with retries; returns the parsed body and header info. */
  async _get(path: string, params: QueryParams = {}): Promise<RawResult> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; ; attempt++) {
      let wait: number;
      let error: ScrapeMapsAPIError;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const response = await this.#fetch(url.toString(), {
          method: "GET",
          headers: this.#headers,
          signal: controller.signal,
        });
        if (response.ok) {
          const text = await response.text();
          let body: unknown;
          try {
            body = JSON.parse(text);
          } catch (e) {
            throw new ScrapeMapsAPIError(`Invalid JSON in response: ${text.slice(0, 200)}`, {
              statusCode: response.status,
              cause: e,
            });
          }
          if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw new ScrapeMapsAPIError("Unexpected response shape", {
              statusCode: response.status,
              body,
            });
          }
          const info = responseInfo(response.headers);
          this.lastResponseInfo = info;
          return { body: body as Record<string, unknown>, info };
        }
        error = await errorFromResponse(response);
        if (
          attempt >= this.maxRetries ||
          !RETRY_STATUSES.has(response.status) ||
          (error.code !== undefined && NO_RETRY_CODES.has(error.code))
        ) {
          throw error;
        }
        if (error.retryAfter !== undefined) {
          if (error.retryAfter * 1000 > this.maxRetryWait) throw error;
          wait = error.retryAfter * 1000;
        } else {
          wait = this.#backoff(attempt);
        }
      } catch (e) {
        if (e instanceof ScrapeMapsAPIError) throw e;
        const timedOut = controller.signal.aborted;
        error = timedOut
          ? new APITimeoutError(`Request timed out after ${this.timeout} ms`, { cause: e })
          : new APIConnectionError(`Could not reach ${this.baseUrl}: ${String(e)}`, { cause: e });
        if (attempt >= this.maxRetries) throw error;
        wait = this.#backoff(attempt);
      } finally {
        clearTimeout(timer);
      }
      await this.#sleep(wait);
    }
  }
}
