/**
 * Response types of the ScrapeMapsAPI API. Field names match the JSON exactly (snake_case).
 */

export type PlaceStatus = "operational" | "temporarily_closed" | "permanently_closed";
export type ReviewSort = "relevant" | "newest" | "highest" | "lowest";
export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface Location {
  lat: number;
  lng: number;
}

export interface Address {
  formatted: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
}

/** Every identifier of a place. `place_id` (ChIJ...) can be null for some places. */
export interface PlaceIds {
  place_id: string | null;
  /** Customer ID, decimal (as in maps?cid=...). */
  cid: string;
  /** Internal feature ID `0x...:0x...`. */
  feature_id: string;
  google_maps_url: string;
}

export type ResolvedIds = PlaceIds;

export interface TimePeriod {
  /** HH:MM, 24h, local time. */
  open: string;
  /** HH:MM, 24h; may be lower than `open` when past midnight. */
  close: string;
}

export interface DayHours {
  day: Weekday;
  closed: boolean;
  open_24h: boolean;
  periods: TimePeriod[];
  /** Hours as Google displays them, localised. */
  text: string | null;
}

export interface OpeningHours {
  weekly: DayHours[];
  /** e.g. "Open · Closes 10 pm", localised. */
  status_text: string | null;
}

export interface Photo {
  url: string;
  width: number | null;
  height: number | null;
}

export interface Link {
  url: string;
  domain: string | null;
}

/** A place as returned by search. */
export interface PlaceSummary {
  /** Place ID (ChIJ...), the primary identifier; null for rare places without one (use `ids.cid`). */
  id: string | null;
  ids: PlaceIds;
  name: string;
  categories: string[];
  address: Address;
  location: Location;
  rating: number | null;
  review_count: number | null;
  phone: string | null;
  website: string | null;
  /** Business status when Google states it; null when unknown. */
  status: PlaceStatus | null;
}

/** A place with full details. */
export interface Place extends PlaceSummary {
  local_name: string | null;
  phone_international: string | null;
  plus_code: string | null;
  timezone: string | null;
  description: string | null;
  opening_hours: OpeningHours | null;
  /** Feature groups, e.g. `{"Accessibility": [...]}`. */
  attributes: Record<string, string[]>;
  photos: Photo[];
  booking_links: Link[];
  knowledge_graph_id: string | null;
}

export interface ReviewAuthor {
  /** Pseudonymous, stable author ID. Names, photos and profile links are never returned. */
  id: string | null;
}

export interface OwnerResponse {
  text: string;
  translated_text: string | null;
  relative_date: string | null;
}

export interface Review {
  id: string;
  rating: number | null;
  /** ISO 8601, UTC. */
  published_at: string | null;
  relative_date: string | null;
  language: string | null;
  text: string | null;
  /** Google's translation into the requested language, if different. */
  translated_text: string | null;
  author: ReviewAuthor;
  owner_response: OwnerResponse | null;
  photos: Photo[];
  /** Structured answers, e.g. `{"Price per person": "€20–30", "Food": "5"}`. */
  details: Record<string, string>;
  /** Review platform, normally "Google". */
  source: string | null;
}

export interface Pagination {
  /** Pass as `cursor` to get the next page; null on the last page. */
  next_cursor: string | null;
  has_more: boolean;
}

export interface Meta {
  /** Credits charged for this call. */
  credits_used: number;
  /** Served entirely from cache. */
  cached: boolean;
}

export interface SearchMeta extends Meta {
  query: string;
  language: string;
  region: string;
}

export interface PlaceMeta extends Meta {
  language: string;
}

export interface ReviewsMeta extends Meta {
  place_id: string | null;
  cid: string;
  sort: ReviewSort;
  language: string;
  original_language: string | null;
}

/** Billing and cache information read from the response headers. */
export interface ResponseInfo {
  /** `X-Credits-Used`: credits charged for this call. */
  creditsUsed: number | null;
  /** `X-Credits-Remaining`: credits left on the account after this call. */
  creditsRemaining: number | null;
  /** `X-Cache`: "HIT" or "MISS". */
  cache: string | null;
  /** `X-Processing-Time` in milliseconds. */
  processingTimeMs: number | null;
}

export interface SearchResponse {
  data: PlaceSummary[];
  pagination: Pagination;
  meta: SearchMeta;
  info: ResponseInfo;
}

export interface PlaceResponse {
  data: Place;
  meta: PlaceMeta;
  info: ResponseInfo;
}

export interface ReviewsResponse {
  data: Review[];
  pagination: Pagination;
  meta: ReviewsMeta;
  info: ResponseInfo;
}

export interface ResolveResponse {
  data: ResolvedIds;
  meta: Meta;
  info: ResponseInfo;
}

// ---------------------------------------------------------------------------
// Request parameters
// ---------------------------------------------------------------------------

export interface SearchParams {
  /** What to search, e.g. "pizzeria in Naples". */
  q: string;
  /** Language of the results, e.g. "en", "it", "pt-BR". Default "en". */
  language?: string;
  /** 2-letter country code, e.g. "us", "it". Default "us". */
  region?: string;
  /** Latitude of the area centre (with `lng`). */
  lat?: number;
  /** Longitude of the area centre (with `lat`). */
  lng?: number;
  /** Area radius in km (with lat/lng), up to 100. */
  radius_km?: number;
  /** Places per page, 1-20 (default 20). */
  limit?: number;
  /** `next_cursor` of the previous page. */
  cursor?: string;
}

export interface GetPlaceParams {
  language?: string;
  region?: string;
}

export interface ReviewsParams {
  /** relevant (default), newest, highest, lowest. */
  sort?: ReviewSort;
  /** Language of the results, also the translation target. */
  language?: string;
  /** Only reviews originally written in this language, e.g. "it". */
  original_language?: string;
  /** Reviews per page, 1-100 (default 20). */
  limit?: number;
  /** `next_cursor` of the previous page. */
  cursor?: string;
}

export interface IterOptions {
  /** Page size (search 1-20, reviews 1-100; default the maximum). */
  pageSize?: number;
  /** Stop after this many items. Also caps the last page, so you never pay for more. */
  maxItems?: number;
}

export type IterSearchParams = Omit<SearchParams, "limit" | "cursor"> & IterOptions;
export type IterReviewsParams = Omit<ReviewsParams, "limit" | "cursor"> & IterOptions;

export interface ClientOptions {
  /** API key. Defaults to the `SCRAPEMAPSAPI_API_KEY` environment variable (Node). */
  apiKey?: string;
  /** API root. Defaults to `SCRAPEMAPSAPI_BASE_URL` or https://api.scrapemapsapi.com. */
  baseUrl?: string;
  /** Milliseconds per request attempt (default 60000). */
  timeout?: number;
  /** Retries on 429/502/503 and network errors (default 2; 0 disables). */
  maxRetries?: number;
  /** Base delay in ms of the exponential backoff, with jitter (default 500). */
  retryBackoff?: number;
  /** Longest wait in ms between retries; a longer Retry-After raises at once (default 30000). */
  maxRetryWait?: number;
  /** Custom fetch implementation (default: global fetch). */
  fetch?: typeof fetch;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** @internal Sleep function, replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Body of every API error: `{"detail": {"error": code, "message": str}}`. */
export interface ErrorResponseBody {
  detail?:
    | { error?: string; message?: string; [key: string]: unknown }
    | Array<{ loc?: Array<string | number>; msg?: string; type?: string }>
    | string;
  error?: string;
  message?: string;
}
