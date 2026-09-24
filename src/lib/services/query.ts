export const PAGE_SIZE = 25;

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function pageRange(page: number, pageSize = PAGE_SIZE) {
  const p = Math.max(1, Math.floor(page) || 1);
  return { page: p, from: (p - 1) * pageSize, to: p * pageSize - 1 };
}

export function paginated<T>(rows: T[], total: number | null, page: number, pageSize = PAGE_SIZE): Paginated<T> {
  const t = total ?? rows.length;
  return { rows, total: t, page, pageSize, pageCount: Math.max(1, Math.ceil(t / pageSize)) };
}

/**
 * Makes user search text safe for a PostgREST `or=(...ilike...)` filter:
 * strips characters that have meaning in the filter grammar.
 */
export function searchPattern(q: string | null | undefined): string | null {
  const cleaned = (q ?? "").replace(/[,()*%\\:"]/g, " ").trim().slice(0, 100);
  return cleaned ? `%${cleaned}%` : null;
}
