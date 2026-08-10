import { availableEquipment } from '@/lib/Equipment';

export interface BankParseResult {
  /** equipable item ids that matched */
  ids: number[];
  /** names that matched at least one equipable item */
  matchedNames: string[];
  /** non-empty lines that matched nothing equipable (fine for consumables etc.) */
  unmatched: string[];
}

const nameIndex = (() => {
  const map = new Map<string, number[]>();
  for (const item of availableEquipment) {
    const key = item.name.toLowerCase();
    const list = map.get(key);
    if (list) list.push(item.id);
    else map.set(key, [item.id]);
  }
  return map;
})();

const idSet = new Set(availableEquipment.map((e) => e.id));

/**
 * Parses bank contents from a variety of paste formats:
 * - RuneLite Bank Memory plugin export (item name<TAB>quantity)
 * - CSV rows ("Item name,quantity" or "id,quantity")
 * - RuneLite bank tag exports ("tagname,id,id,id,...")
 * - plain item names, one per line
 */
export function parseBankText(text: string): BankParseResult {
  const ids = new Set<number>();
  const matchedNames: string[] = [];
  const unmatched: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const tokens = line.includes('\t') ? line.split('\t') : line.split(',');
    const numeric: number[] = [];
    const words: string[] = [];
    for (const tok of tokens) {
      const t = tok.trim();
      if (!t) continue;
      if (/^[\d,]+$/.test(t) && !Number.isNaN(parseInt(t.replaceAll(',', ''), 10))) {
        numeric.push(parseInt(t.replaceAll(',', ''), 10));
      } else {
        words.push(t);
      }
    }

    // bank tag export or raw id list: many numeric tokens
    if (numeric.length >= 3 || (numeric.length >= 1 && words.length === 0)) {
      let any = false;
      for (const id of numeric) {
        if (idSet.has(id)) {
          ids.add(id);
          any = true;
        }
      }
      if (!any && words.length === 0) unmatched.push(line);
      if (words.length === 0 || any) continue;
    }

    // name (+ optional quantity/value columns)
    const name = words.join(',').trim();
    if (!name) continue;
    const matched = nameIndex.get(name.toLowerCase());
    if (matched) {
      for (const id of matched) ids.add(id);
      matchedNames.push(name);
    } else {
      unmatched.push(name);
    }
  }

  return { ids: [...ids], matchedNames, unmatched };
}

/** case-insensitive substring search over equipable items, for the manual-add box */
export function searchEquipment(query: string, limit = 25) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const seen = new Set<string>();
  const out = [];
  for (const item of availableEquipment) {
    if (!item.name.toLowerCase().includes(q)) continue;
    const key = `${item.name}|${item.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
