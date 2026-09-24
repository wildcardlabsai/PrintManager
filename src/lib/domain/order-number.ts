/** Mirrors public.next_order_number() so Settings can preview the format. */
export function formatOrderNumber(
  format: string,
  prefix: string,
  seq: number,
  padding: number,
  now: Date = new Date(),
): string {
  const yyyy = String(now.getFullYear());
  return format
    .replaceAll("{PREFIX}", prefix)
    .replaceAll("{YYYY}", yyyy)
    .replaceAll("{YY}", yyyy.slice(-2))
    .replaceAll("{MM}", String(now.getMonth() + 1).padStart(2, "0"))
    .replaceAll("{SEQ}", String(seq).padStart(padding, "0"));
}
