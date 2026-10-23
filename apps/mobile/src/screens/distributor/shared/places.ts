/**
 * Free place search through OpenStreetMap Nominatim (no key; it asks for an identifying User-Agent),
 * kept from the first Add client screen. It only moves the map: the delivery spot is always the pin,
 * and the server decides its zone and price.
 */
export interface PlaceResult {
  key: string;
  name: string;
  lat: number;
  lng: number;
}

const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const SEARCH_TIMEOUT_MS = 10_000;
/** Nominatim's usage policy asks for an application User-Agent. */
const USER_AGENT = 'SmartFleet-ShopApp/1.0';
export const PLACE_SEARCH_MIN_LENGTH = 3;

interface NominatimRow {
  place_id?: number | string;
  display_name?: string;
  lat?: string;
  lon?: string;
}

/** Up to 8 places in Pakistan matching `query`. Rejects on a network failure. */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const text = query.trim();
  if (text.length < PLACE_SEARCH_MIN_LENGTH) return [];
  const url = `${SEARCH_URL}?format=json&limit=8&countrycodes=pk&q=${encodeURIComponent(text)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`place search ${response.status}`);
    const rows = (await response.json()) as NominatimRow[];
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row, index) => {
      const lat = Number(row.lat);
      const lng = Number(row.lon);
      if (!row.display_name || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      return [{ key: String(row.place_id ?? index), name: row.display_name, lat, lng }];
    });
  } finally {
    clearTimeout(timer);
  }
}
