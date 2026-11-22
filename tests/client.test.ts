import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APIConnectionError,
  APITimeoutError,
  AuthenticationError,
  CreditsCooldownError,
  DEFAULT_BASE_URL,
  ScrapeMapsAPI,
  ScrapeMapsAPIError,
  InsufficientCreditsError,
  InternalServerError,
  InvalidRequestError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  UpstreamError,
  VERSION,
  type ClientOptions,
} from "../src/index.js";
import {
  PLACE,
  PLACE_IDS,
  PLACE_SUMMARY,
  apiError,
  json,
  review,
  reviewsBody,
  searchBody,
} from "./fixtures.js";

const BASE = "https://api.test.scrapemapsapi";
const RESOLVE_OK = { data: PLACE_IDS, meta: { credits_used: 0, cached: false } };

type Item = Response | Error;

function setup(items: Item[] = [], options: ClientOptions = {}) {
  const queue = [...items];
  const requests: { url: URL; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: new URL(String(input)), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${String(input)}`);
    if (next instanceof Error) throw next;
    return next;
  });
  const client = new ScrapeMapsAPI({
    apiKey: "test_key",
    baseUrl: BASE,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });
  return {
    client,
    requests,
    sleeps,
    push: (...more: Item[]) => queue.push(...more),
    last: () => requests[requests.length - 1],
  };
}

const params = (u: URL) => Object.fromEntries(u.searchParams.entries());

describe("configuration", () => {
  beforeEach(() => {
    vi.stubEnv("SCRAPEMAPSAPI_API_KEY", "");
    vi.stubEnv("SCRAPEMAPSAPI_BASE_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses defaults", () => {
    const c = new ScrapeMapsAPI({ apiKey: "k" });
    expect(c.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(DEFAULT_BASE_URL).toBe("https://api.scrapemapsapi.com");
    expect(c.maxRetries).toBe(2);
    expect(c.creditsRemaining).toBeNull();
  });

  it("reads env vars", () => {
    vi.stubEnv("SCRAPEMAPSAPI_API_KEY", "env_key");
    vi.stubEnv("SCRAPEMAPSAPI_BASE_URL", "http://localhost:8000/");
    const c = new ScrapeMapsAPI();
    expect(c.baseUrl).toBe("http://localhost:8000");
  });

  it("options beat env", () => {
    vi.stubEnv("SCRAPEMAPSAPI_BASE_URL", "http://env");
    expect(new ScrapeMapsAPI({ apiKey: "k", baseUrl: "http://arg//" }).baseUrl).toBe("http://arg");
  });

  it("throws without an API key", () => {
    expect(() => new ScrapeMapsAPI()).toThrow(AuthenticationError);
    expect(() => new ScrapeMapsAPI()).toThrow(/SCRAPEMAPSAPI_API_KEY/);
  });

  it("does not expose the key", () => {
    const c = new ScrapeMapsAPI({ apiKey: "secret_key" });
    const { places: _places, ...rest } = c;
    void _places;
    expect(JSON.stringify(rest)).not.toContain("secret_key");
  });
});

describe("places.search", () => {
  it("sends params and headers, parses the response and credits", async () => {
    const t = setup([
      json(searchBody([PLACE_SUMMARY], "cur1"), 200, {
        "X-Credits-Used": "1",
        "X-Credits-Remaining": "199",
        "X-Cache": "MISS",
        "X-Processing-Time": "321",
      }),
    ]);
    const res = await t.client.places.search({
      q: "pizza",
      language: "it",
      region: "it",
      lat: 40.85,
      lng: 14.26,
      radius_km: 2,
      limit: 5,
    });
    const req = t.last();
    expect(req.url.origin + req.url.pathname).toBe(`${BASE}/v1/places/search`);
    expect(params(req.url)).toEqual({
      q: "pizza",
      language: "it",
      region: "it",
      lat: "40.85",
      lng: "14.26",
      radius_km: "2",
      limit: "5",
    });
    const headers = req.init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("test_key");
    expect(headers["User-Agent"]).toBe(`scrapemapsapi-js/${VERSION}`);

    expect(res.data[0].name).toBe("Pizzeria Da Michele");
    expect(res.data[0].ids.feature_id).toBe(PLACE_IDS.feature_id);
    expect(res.pagination).toEqual({ next_cursor: "cur1", has_more: true });
    expect(res.meta.query).toBe("pizza");
    expect(res.info).toEqual({ creditsUsed: 1, creditsRemaining: 199, cache: "MISS", processingTimeMs: 321 });
    expect(t.client.creditsRemaining).toBe(199);
  });

  it("omits unset params", async () => {
    const t = setup([json(searchBody([]))]);
    const res = await t.client.places.search({ q: "pizza" });
    expect(params(t.last().url)).toEqual({ q: "pizza" });
    expect(res.info.creditsRemaining).toBeNull();
  });

  it("rejects lat without lng", async () => {
    const t = setup();
    await expect(t.client.places.search({ q: "x", lat: 1 })).rejects.toThrow(TypeError);
  });
});

describe("places.get / reviews / resolve", () => {
  it("gets details", async () => {
    const t = setup([json({ data: PLACE, meta: { credits_used: 2, cached: true, language: "it" } }, 200, { "X-Credits-Used": "2" })]);
    const res = await t.client.places.get(PLACE_IDS.place_id!, { language: "it" });
    expect(t.last().url.pathname).toBe(`/v1/places/${PLACE_IDS.place_id}`);
    expect(params(t.last().url)).toEqual({ language: "it" });
    expect(res.data.opening_hours?.weekly[0].periods[0].open).toBe("11:00");
    expect(res.data.attributes.Accessibility).toEqual(["Wheelchair-accessible entrance"]);
    expect(res.meta.cached).toBe(true);
    expect(res.info.creditsUsed).toBe(2);
  });

  it("URL-encodes feature IDs", async () => {
    const t = setup([json({ data: PLACE, meta: { credits_used: 2, cached: false, language: "en" } })]);
    await t.client.places.get(PLACE_IDS.feature_id);
    expect(t.last().url.pathname).toBe("/v1/places/0x6b12ae37b4b75b37%3A0x8eadf8dc1b32ca52");
  });

  it("rejects an empty place", async () => {
    const t = setup();
    await expect(t.client.places.get(" ")).rejects.toThrow(TypeError);
  });

  it("gets a page of reviews", async () => {
    const t = setup([json(reviewsBody([review(1), review(2)], "c2"))]);
    const res = await t.client.places.reviews("123", { sort: "newest", original_language: "it", limit: 2 });
    expect(t.last().url.pathname).toBe("/v1/places/123/reviews");
    expect(params(t.last().url)).toEqual({ sort: "newest", original_language: "it", limit: "2" });
    expect(res.data[0].owner_response?.translated_text).toBe("Thanks!");
    expect(res.meta.cid).toBe(PLACE_IDS.cid);
    expect(res.pagination.next_cursor).toBe("c2");
  });

  it("resolves", async () => {
    const t = setup([json(RESOLVE_OK)]);
    const res = await t.client.places.resolve("https://maps.app.goo.gl/abc");
    expect(t.last().url.pathname).toBe("/v1/places/resolve");
    expect(t.last().url.searchParams.get("input")).toBe("https://maps.app.goo.gl/abc");
    expect(res.data.cid).toBe(PLACE_IDS.cid);
  });
});

describe("auto-pagination", () => {
  it("iterSearch follows the cursor", async () => {
    const t = setup([
      json(searchBody([PLACE_SUMMARY, PLACE_SUMMARY], "c1")),
      json(searchBody([PLACE_SUMMARY])),
    ]);
    const out = [];
    for await (const p of t.client.places.iterSearch({ q: "pizza", region: "it" })) out.push(p);
    expect(out).toHaveLength(3);
    expect(t.requests[0].url.searchParams.get("cursor")).toBeNull();
    expect(t.requests[0].url.searchParams.get("limit")).toBe("20");
    expect(t.requests[1].url.searchParams.get("cursor")).toBe("c1");
    expect(t.requests[1].url.searchParams.get("region")).toBe("it");
  });

  it("iterReviews caps the page size with maxItems", async () => {
    const t = setup([
      json(reviewsBody([review(0), review(1), review(2)], "c1")),
      json(reviewsBody([review(3), review(4)], "c2")),
    ]);
    const ids: string[] = [];
    for await (const r of t.client.places.iterReviews("123", { pageSize: 3, maxItems: 5, sort: "newest" })) {
      ids.push(r.id);
    }
    expect(ids).toEqual(["rev0", "rev1", "rev2", "rev3", "rev4"]);
    expect(t.requests[0].url.searchParams.get("limit")).toBe("3");
    expect(t.requests[1].url.searchParams.get("limit")).toBe("2");
    expect(t.requests[1].url.searchParams.get("cursor")).toBe("c1");
    expect(t.requests).toHaveLength(2);
  });

  it("iterReviews defaults to 100 per page", async () => {
    const t = setup([json(reviewsBody([review(1)]))]);
    for await (const _ of t.client.places.iterReviews("123")) void _;
    expect(t.last().url.searchParams.get("limit")).toBe("100");
  });

  it("stops on a repeated cursor or an empty page", async () => {
    const t = setup([json(reviewsBody([review(1)], "same")), json(reviewsBody([review(2)], "same"))]);
    let n = 0;
    for await (const _ of t.client.places.iterReviews("123")) n++;
    expect(n).toBe(2);
    expect(t.requests).toHaveLength(2);

    const t2 = setup([json(reviewsBody([], "c1"))]);
    for await (const _ of t2.client.places.iterReviews("123")) n++;
    expect(t2.requests).toHaveLength(1);
  });

  it("is lazy", async () => {
    const t = setup([json(searchBody([PLACE_SUMMARY], "c1"))]);
    const it = t.client.places.iterSearch({ q: "pizza" });
    expect(t.requests).toHaveLength(0);
    await it.next();
    expect(t.requests).toHaveLength(1);
  });
});

describe("errors", () => {
  const cases: [number, string, new (...a: never[]) => ScrapeMapsAPIError][] = [
    [400, "invalid_place_id", InvalidRequestError],
    [400, "invalid_cursor", InvalidRequestError],
    [400, "invalid_location", InvalidRequestError],
    [401, "missing_api_key", AuthenticationError],
    [401, "invalid_api_key", AuthenticationError],
    [402, "insufficient_credits", InsufficientCreditsError],
    [404, "place_not_found", NotFoundError],
    [429, "rate_limit_exceeded", RateLimitError],
    [429, "insufficient_credits_retry_later", CreditsCooldownError],
    [502, "upstream_error", UpstreamError],
    [502, "proxy_error", UpstreamError],
    [502, "rate_limited", UpstreamError],
    [503, "upstream_unavailable", ServiceUnavailableError],
    [500, "internal_server_error", InternalServerError],
    [500, "whatever", InternalServerError],
    [418, "teapot", ScrapeMapsAPIError],
  ];

  it.each(cases)("%i %s", async (status, code, Cls) => {
    const t = setup([apiError(status, code, "explained")], { maxRetries: 0 });
    const err = await t.client.places.resolve("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Cls);
    expect((err as Error).constructor).toBe(Cls);
    expect(err).toMatchObject({ statusCode: status, code, message: "explained", name: Cls.name });
  });

  it("hierarchy", () => {
    expect(new ServiceUnavailableError("x")).toBeInstanceOf(UpstreamError);
    expect(new CreditsCooldownError("x")).toBeInstanceOf(RateLimitError);
    expect(new APITimeoutError("x")).toBeInstanceOf(APIConnectionError);
    expect(new NotFoundError("x")).toBeInstanceOf(Error);
  });

  it("handles a plain-text 429 from the edge proxy", async () => {
    const t = setup([new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "1" } })], {
      maxRetries: 0,
    });
    const err = await t.client.places.get("1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).toMatchObject({ statusCode: 429, code: undefined, message: "Too Many Requests", retryAfter: 1 });
  });

  it("reads the real FastAPI 422 body", async () => {
    const t = setup([
      json(
        {
          detail: [
            {
              type: "less_than_equal",
              loc: ["query", "limit"],
              msg: "Input should be less than or equal to 20",
              input: "50",
              ctx: { le: 20 },
            },
          ],
        },
        422
      ),
    ]);
    const err = await t.client.places.search({ q: "x", limit: 50 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err).toMatchObject({ code: "validation_error", message: "limit: Input should be less than or equal to 20" });
  });

  it("falls back to the status code without a JSON body", async () => {
    const t = setup([new Response("not here", { status: 404 })]);
    await expect(t.client.places.get("1")).rejects.toThrow(NotFoundError);
  });

  it("formats 422 validation errors", async () => {
    const t = setup([
      json({ detail: [{ loc: ["query", "limit"], msg: "Input should be <= 20", type: "less_than_equal" }] }, 422),
    ]);
    const err = await t.client.places.search({ q: "x", limit: 50 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err).toMatchObject({ code: "validation_error", message: "limit: Input should be <= 20" });
  });

  it("exposes available/required credits", async () => {
    const t = setup([apiError(402, "insufficient_credits", "no", {}, { available: 1, required: 2 })]);
    const err = (await t.client.places.get("1").catch((e: unknown) => e)) as InsufficientCreditsError;
    expect(err.available).toBe(1);
    expect(err.required).toBe(2);
  });

  it("rejects invalid JSON", async () => {
    const t = setup([new Response("<html>", { status: 200 })]);
    await expect(t.client.places.resolve("x")).rejects.toThrow(/Invalid JSON/);
  });
});

describe("retries", () => {
  it("retries 503 and 502 then succeeds", async () => {
    const t = setup([apiError(503, "upstream_unavailable"), apiError(502, "upstream_error"), json(RESOLVE_OK)]);
    const res = await t.client.places.resolve("x");
    expect(res.data.cid).toBe(PLACE_IDS.cid);
    expect(t.requests).toHaveLength(3);
    expect(t.sleeps).toHaveLength(2);
  });

  it("gives up after maxRetries", async () => {
    const t = setup(Array.from({ length: 4 }, () => apiError(503, "upstream_unavailable")), { maxRetries: 3 });
    await expect(t.client.places.resolve("x")).rejects.toThrow(ServiceUnavailableError);
    expect(t.requests).toHaveLength(4);
    expect(t.sleeps).toHaveLength(3);
  });

  it("uses exponential backoff with jitter", async () => {
    const t = setup(Array.from({ length: 3 }, () => apiError(502, "upstream_error")), { retryBackoff: 1000 });
    await expect(t.client.places.resolve("x")).rejects.toThrow(UpstreamError);
    expect(t.sleeps[0]).toBeGreaterThanOrEqual(500);
    expect(t.sleeps[0]).toBeLessThanOrEqual(1000);
    expect(t.sleeps[1]).toBeGreaterThanOrEqual(1000);
    expect(t.sleeps[1]).toBeLessThanOrEqual(2000);
  });

  it("honours Retry-After", async () => {
    const t = setup([apiError(429, "rate_limited", "slow down", { "Retry-After": "3" }), json(RESOLVE_OK)]);
    await t.client.places.resolve("x");
    expect(t.sleeps).toEqual([3000]);
  });

  it("does not wait for a Retry-After above maxRetryWait", async () => {
    const t = setup([apiError(429, "rate_limited", "slow down", { "Retry-After": "120" })]);
    const err = (await t.client.places.resolve("x").catch((e: unknown) => e)) as RateLimitError;
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(120);
    expect(t.sleeps).toEqual([]);
  });

  it("never retries the credit cooldown", async () => {
    const t = setup([apiError(429, "insufficient_credits_retry_later", "top up", { "Retry-After": "5" })]);
    const err = (await t.client.places.resolve("x").catch((e: unknown) => e)) as CreditsCooldownError;
    expect(err).toBeInstanceOf(CreditsCooldownError);
    expect(err.retryAfter).toBe(5);
    expect(t.requests).toHaveLength(1);
  });

  it.each([
    [404, "place_not_found"],
    [402, "insufficient_credits"],
    [400, "invalid_place_id"],
    [500, "internal"],
  ])("does not retry %i", async (status, code) => {
    const t = setup([apiError(status, code)]);
    await expect(t.client.places.resolve("x")).rejects.toThrow(ScrapeMapsAPIError);
    expect(t.requests).toHaveLength(1);
    expect(t.sleeps).toEqual([]);
  });

  it("retries network errors", async () => {
    const t = setup([new TypeError("fetch failed"), json(RESOLVE_OK)]);
    await t.client.places.resolve("x");
    expect(t.requests).toHaveLength(2);
  });

  it("wraps network errors", async () => {
    const t = setup([new TypeError("fetch failed")], { maxRetries: 0 });
    await expect(t.client.places.resolve("x")).rejects.toThrow(APIConnectionError);
  });

  it("times out", async () => {
    const hanging = vi.fn(
      (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );
    const c = new ScrapeMapsAPI({
      apiKey: "k",
      baseUrl: BASE,
      timeout: 10,
      maxRetries: 1,
      fetch: hanging as unknown as typeof fetch,
      sleep: async () => {},
    });
    await expect(c.places.resolve("x")).rejects.toThrow(APITimeoutError);
    expect(hanging).toHaveBeenCalledTimes(2);
  });
});
