// Shared narrow type-guards over MongoDB driver errors. Kept in one place so
// repository implementations don't each carry a private copy of the same
// error-shape check (the driver does not expose typed error classes).

// MongoDB writes that violate a unique index surface with code 11000.
// Repositories use this guard to translate the raw driver error into a
// domain-specific stale/conflict exception.
export const isDuplicateKeyError = (err: unknown): boolean => {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
};

// When a write touches multiple unique indexes, the driver attaches a
// `keyPattern` describing which one was violated. Repos that need to
// distinguish (e.g. "slug taken" vs "id collision = stale aggregate") use
// this to look up the offending field.
export const violatedKeyPatternHas = (err: unknown, field: string): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const pattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern;
  return Boolean(pattern && field in pattern);
};
