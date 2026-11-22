# ScrapeMapsAPI JavaScript/TypeScript SDK

Official SDK for the [ScrapeMapsAPI](https://scrapemapsapi.com) API: search Google Maps places, get full place details and page through **all** the reviews of a place.

- Typed interfaces that match the API's JSON field by field
- Async iterators that follow the cursors for you: `iterSearch`, `iterReviews`
- Typed error classes, automatic retries on 429/502/503
- `fetch`-based, zero dependencies: Node 18+, Deno, Bun, browsers. ESM and CommonJS.

## Installation

```bash
npm install scrapemapsapi
```

## Quick start

```ts
import { ScrapeMapsAPI } from "scrapemapsapi";

const client = new ScrapeMapsAPI({ apiKey: "your_api_key" }); // or set SCRAPEMAPSAPI_API_KEY

// Search
const page = await client.places.search({ q: "pizzeria in Naples", language: "it", region: "it", limit: 5 });
for (const place of page.data) {
  console.log(place.name, place.rating, place.review_count, place.address.formatted);
}

// Details (2 credits)
const ref = page.data[0].id ?? page.data[0].ids.cid;
const { data: place } = await client.places.get(ref);
console.log(place.phone_international, place.website, place.opening_hours?.status_text);

// One page of reviews
const reviews = await client.places.reviews(ref, { sort: "newest", limit: 20 });
for (const r of reviews.data) console.log(r.rating, r.published_at, r.translated_text ?? r.text);

console.log("credits used:", reviews.info.creditsUsed, "remaining:", reviews.info.creditsRemaining);
```

`place` can be a place ID (`ChIJ...`), a CID (`10281119596374313554`) or a feature ID (`0x...:0x...`); it is URL-encoded for you. `id` is null for the rare places without a place ID: use `ids.cid` then.

## Auto-pagination

```ts
// Every review written in Italian, newest first, translated to English
for await (const review of client.places.iterReviews(ref, { sort: "newest", original_language: "it", language: "en" })) {
  console.log(review.rating, review.text);
}

// At most 50 places for a query in an area
for await (const place of client.places.iterSearch({ q: "coffee", lat: 45.4642, lng: 9.19, radius_km: 2, maxItems: 50 })) {
  console.log(place.name);
}
```

`pageSize` sets the page size (search 1–20, reviews 1–100, default the maximum). `maxItems` also caps the size of the last request, so you never pay for items you don't consume.

Manual paging:

```ts
let res = await client.places.reviews(ref, { limit: 100 });
while (res.pagination.has_more) {
  res = await client.places.reviews(ref, { limit: 100, cursor: res.pagination.next_cursor! });
}
```

## Resolve identifiers and Google Maps URLs

```ts
const { data: ids } = await client.places.resolve("https://maps.app.goo.gl/xxxx");
console.log(ids.place_id, ids.cid, ids.feature_id, ids.google_maps_url);
```

Free when the conversion is offline, 1 credit when a lookup is needed.

## Configuration

```ts
const client = new ScrapeMapsAPI({
  apiKey: "...",                     // default: process.env.SCRAPEMAPSAPI_API_KEY
  baseUrl: "http://localhost:8000",  // default: SCRAPEMAPSAPI_BASE_URL or https://api.scrapemapsapi.com
  timeout: 60_000,                   // ms per attempt
  maxRetries: 2,                     // retries on 429/502/503 and network errors; 0 disables
  retryBackoff: 500,                 // ms, base of the exponential backoff (with jitter)
  maxRetryWait: 30_000,              // never wait longer; a longer Retry-After throws at once
  fetch: customFetch,                // optional fetch implementation
  headers: { "X-Trace": "1" },       // optional extra headers
});
```

Retries honour `Retry-After`. A `429 insufficient_credits_retry_later` (key in a no-credit cooldown) is never retried. Don't ship your API key to browsers you don't control: call the API from your server.

## Credits

Every response has `info`, read from the headers:

| Field | Header |
|---|---|
| `info.creditsUsed` | `X-Credits-Used` |
| `info.creditsRemaining` | `X-Credits-Remaining` |
| `info.cache` | `X-Cache` (`HIT` / `MISS`) |
| `info.processingTimeMs` | `X-Processing-Time` |

`client.creditsRemaining` keeps the value of the last successful call (useful inside iterators). `meta.credits_used` is also in the body.

Costs: search 1 credit per place returned, details 2, reviews 1 per 2 reviews returned (rounded up), resolve 0–1. Errors and empty pages are free.

## Errors

```ts
import { ScrapeMapsAPIError, NotFoundError, RateLimitError } from "scrapemapsapi";

try {
  await client.places.get("ChIJ...");
} catch (e) {
  if (e instanceof NotFoundError) { /* ... */ }
  else if (e instanceof RateLimitError) console.log("retry in", e.retryAfter, "s");
  else if (e instanceof ScrapeMapsAPIError) console.log(e.statusCode, e.code, e.message);
}
```

| Class | HTTP | Codes |
|---|---|---|
| `InvalidRequestError` | 400, 422 | `invalid_place_id`, `invalid_cursor`, `invalid_location`, `validation_error` |
| `AuthenticationError` | 401 | `missing_api_key`, `invalid_api_key` (also thrown when no key is configured) |
| `InsufficientCreditsError` | 402 | `insufficient_credits` (`available`, `required`) |
| `NotFoundError` | 404 | `place_not_found` |
| `RateLimitError` | 429 | `rate_limit_exceeded`, or no code on a plain-text 429 from the edge proxy (`retryAfter` in seconds) |
| `CreditsCooldownError` (extends `RateLimitError`) | 429 | `insufficient_credits_retry_later` |
| `UpstreamError` | 502 | `upstream_error`, `proxy_error` (short link could not be followed) |
| `ServiceUnavailableError` (extends `UpstreamError`) | 503 | `upstream_unavailable` |
| `InternalServerError` | 500, other 5xx | `internal_server_error` |
| `APIConnectionError` / `APITimeoutError` | none | network failure / timeout |

All extend `ScrapeMapsAPIError`.

## Development

```bash
npm install
npm run build      # tsup: ESM + CJS + .d.ts
npm test           # vitest
npm run typecheck  # tsc --noEmit (sources and tests)
```

## License

MIT
