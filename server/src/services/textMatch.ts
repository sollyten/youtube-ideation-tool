/** Title normalization shared with scripts/dedupe.py's norm() for matching. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
