import type { ScrapeMapsAPI, QueryParams, RawResult } from "../client.js";
import type {
  GetPlaceParams,
  IterReviewsParams,
  IterSearchParams,
  PlaceResponse,
  PlaceSummary,
  ResolveResponse,
  Review,
  ReviewsParams,
  ReviewsResponse,
  SearchParams,
  SearchResponse,
} from "../types.js";

export const SEARCH_MAX_LIMIT = 20;
export const REVIEWS_MAX_LIMIT = 100;

/** `/v1/places/{place}{suffix}` with `place` URL-encoded (feature IDs contain `:`). */
export function placePath(place: string, suffix = ""): string {
  if (typeof place !== "string" || !place.trim()) {
    throw new TypeError("place must be a non-empty place ID (ChIJ...), CID or feature ID");
  }
  return `/v1/places/${encodeURIComponent(place.trim())}${suffix}`;
}

function pageLimit(pageSize: number | undefined, maxItems: number | undefined, seen: number, max: number) {
  let size = Math.min(pageSize || max, max);
  if (maxItems !== undefined) size = Math.min(size, maxItems - seen);
  return Math.max(1, size);
}

function withInfo<T>(raw: RawResult): T {
  return { ...raw.body, info: raw.info } as T;
}

/** `client.places`: search, details, reviews, resolve, plus auto-paginating iterators. */
export class PlacesAPI {
  constructor(private readonly client: ScrapeMapsAPI) {}

  /**
   * Text search, optionally biased to an area (`lat`+`lng`, `radius_km`).
   * 1 credit per place returned. Use `iterSearch` to page automatically.
   */
  async search(params: SearchParams): Promise<SearchResponse> {
    if ((params.lat === undefined) !== (params.lng === undefined)) {
      throw new TypeError("Provide both lat and lng, or neither.");
    }
    const query: QueryParams = {
      q: params.q,
      language: params.language,
      region: params.region,
      lat: params.lat,
      lng: params.lng,
      radius_km: params.radius_km,
      limit: params.limit,
      cursor: params.cursor,
    };
    return withInfo<SearchResponse>(await this.client._get("/v1/places/search", query));
  }

  /** Full details of a place: place ID (ChIJ...), CID or feature ID (0x...:0x...). 2 credits. */
  async get(place: string, params: GetPlaceParams = {}): Promise<PlaceResponse> {
    const query: QueryParams = { language: params.language, region: params.region };
    return withInfo<PlaceResponse>(await this.client._get(placePath(place), query));
  }

  /** One page of reviews. 1 credit per 2 reviews returned (rounded up). */
  async reviews(place: string, params: ReviewsParams = {}): Promise<ReviewsResponse> {
    const query: QueryParams = {
      sort: params.sort,
      language: params.language,
      original_language: params.original_language,
      limit: params.limit,
      cursor: params.cursor,
    };
    return withInfo<ReviewsResponse>(await this.client._get(placePath(place, "/reviews"), query));
  }

  /**
   * Convert a place ID, CID, feature ID or Google Maps URL (short links too) into every
   * identifier. Free when offline, 1 credit when a lookup is needed.
   */
  async resolve(input: string): Promise<ResolveResponse> {
    return withInfo<ResolveResponse>(await this.client._get("/v1/places/resolve", { input }));
  }

  /** Every place of a search, following `next_cursor` until the end or `maxItems`. */
  async *iterSearch(params: IterSearchParams): AsyncGenerator<PlaceSummary, void, undefined> {
    const { pageSize, maxItems, ...rest } = params;
    let seen = 0;
    let cursor: string | undefined;
    while (maxItems === undefined || seen < maxItems) {
      const limit = pageLimit(pageSize, maxItems, seen, SEARCH_MAX_LIMIT);
      const page = await this.search({ ...rest, limit, cursor });
      for (const place of page.data) {
        yield place;
        seen++;
        if (maxItems !== undefined && seen >= maxItems) return;
      }
      const next = page.pagination.next_cursor;
      if (!page.pagination.has_more || !next || next === cursor || page.data.length === 0) return;
      cursor = next;
    }
  }

  /** Every review of a place, following `next_cursor` until the end or `maxItems`. */
  async *iterReviews(
    place: string,
    params: IterReviewsParams = {}
  ): AsyncGenerator<Review, void, undefined> {
    const { pageSize, maxItems, ...rest } = params;
    let seen = 0;
    let cursor: string | undefined;
    while (maxItems === undefined || seen < maxItems) {
      const limit = pageLimit(pageSize, maxItems, seen, REVIEWS_MAX_LIMIT);
      const page = await this.reviews(place, { ...rest, limit, cursor });
      for (const review of page.data) {
        yield review;
        seen++;
        if (maxItems !== undefined && seen >= maxItems) return;
      }
      const next = page.pagination.next_cursor;
      if (!page.pagination.has_more || !next || next === cursor || page.data.length === 0) return;
      cursor = next;
    }
  }
}
