import type { PlaceIds, PlaceSummary, Place, Review } from "../src/index.js";

export const PLACE_IDS: PlaceIds = {
  place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  cid: "10281119596374313554",
  feature_id: "0x6b12ae37b4b75b37:0x8eadf8dc1b32ca52",
  google_maps_url: "https://www.google.com/maps?cid=10281119596374313554",
};

export const PLACE_SUMMARY: PlaceSummary = {
  id: PLACE_IDS.place_id,
  ids: PLACE_IDS,
  name: "Pizzeria Da Michele",
  categories: ["Pizza restaurant"],
  address: {
    formatted: "Via Cesare Sersale, 1, 80139 Napoli NA, Italy",
    street: "Via Cesare Sersale, 1",
    postal_code: "80139",
    city: "Napoli",
    region: "Campania",
    country_code: "IT",
  },
  location: { lat: 40.8497, lng: 14.2635 },
  rating: 4.6,
  review_count: 52000,
  phone: "081 553 9204",
  website: "https://damichele.net",
  status: "operational",
};

export const PLACE: Place = {
  ...PLACE_SUMMARY,
  local_name: "L'Antica Pizzeria da Michele",
  phone_international: "+39 081 553 9204",
  plus_code: "RQ2G+V9 Napoli",
  timezone: "Europe/Rome",
  description: "Historic pizzeria.",
  opening_hours: {
    weekly: [
      { day: "monday", closed: false, open_24h: false, periods: [{ open: "11:00", close: "23:00" }], text: "11 am-11 pm" },
    ],
    status_text: "Open · Closes 11 pm",
  },
  attributes: { Accessibility: ["Wheelchair-accessible entrance"] },
  photos: [{ url: "https://lh3.example/p1", width: 800, height: 600 }],
  booking_links: [{ url: "https://book.example/x", domain: "book.example" }],
  knowledge_graph_id: "/g/11b6",
};

export function review(i: number): Review {
  return {
    id: `rev${i}`,
    rating: 5,
    published_at: "2026-10-01T12:00:00Z",
    relative_date: "a month ago",
    language: "it",
    text: `Ottima pizza ${i}`,
    translated_text: `Great pizza ${i}`,
    author: { id: `a${i}` },
    owner_response: { text: "Grazie!", translated_text: "Thanks!", relative_date: "a month ago" },
    photos: [],
    details: { Food: "5" },
    source: "Google",
  };
}

export function searchBody(places: PlaceSummary[], nextCursor: string | null = null) {
  return {
    data: places,
    pagination: { next_cursor: nextCursor, has_more: nextCursor !== null },
    meta: { credits_used: places.length, cached: false, query: "pizza", language: "en", region: "us" },
  };
}

export function reviewsBody(reviews: Review[], nextCursor: string | null = null) {
  return {
    data: reviews,
    pagination: { next_cursor: nextCursor, has_more: nextCursor !== null },
    meta: {
      credits_used: Math.ceil(reviews.length / 2),
      cached: true,
      place_id: PLACE_IDS.place_id,
      cid: PLACE_IDS.cid,
      sort: "newest",
      language: "en",
      original_language: null,
    },
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function apiError(
  status: number,
  code: string,
  message = "boom",
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {}
): Response {
  return json({ detail: { error: code, message, ...extra } }, status, headers);
}
