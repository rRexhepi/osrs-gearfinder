import { itemById } from '@/solver/data';
import { EXTRA_PRICE_IDS, PriceMap } from '@/solver/xp';

const CACHE_KEY = 'gearfinder-prices';
const MAX_AGE_MS = 60 * 60 * 1000;
const API = 'https://prices.runescape.wiki/api/v1/osrs/latest';

interface CachedPrices {
  fetchedAt: number;
  prices: PriceMap;
}

let inFlight: Promise<PriceMap | null> | null = null;

/**
 * Latest GE mid-prices for every equipable item (+ runes/scales), cached in
 * localStorage for an hour. Returns null when offline and no cache exists.
 */
export function getPrices(): Promise<PriceMap | null> {
  if (!inFlight) inFlight = fetchPrices().finally(() => { setTimeout(() => { inFlight = null; }, 0); });
  return inFlight;
}

async function fetchPrices(): Promise<PriceMap | null> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as CachedPrices;
      if (Date.now() - cached.fetchedAt < MAX_AGE_MS) return cached.prices;
    }
  } catch { /* fall through to refetch */ }

  try {
    const res = await fetch(API, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as { data: Record<string, { high: number | null; low: number | null }> };
    const wanted = new Set<number>([...itemById.keys(), ...EXTRA_PRICE_IDS]);
    const prices: PriceMap = {};
    for (const [idStr, p] of Object.entries(body.data)) {
      const id = parseInt(idStr, 10);
      if (!wanted.has(id)) continue;
      const high = p.high ?? p.low;
      const low = p.low ?? p.high;
      if (high === null || low === null) continue;
      prices[id] = Math.round((high + low) / 2);
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), prices } satisfies CachedPrices));
    } catch { /* cache is best-effort */ }
    return prices;
  } catch {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) return (JSON.parse(raw) as CachedPrices).prices;
    } catch { /* no cache */ }
    return null;
  }
}
