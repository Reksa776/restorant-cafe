import { RateLimitError } from "@/lib/errors";

// ============================================================
// Lightweight in-memory rate limiter.
//
// Intended for PUBLIC/unauthenticated endpoints that are otherwise
// trivial to abuse (order lookup, order/payment creation, menu/table
// lookups). Production runs a SINGLE Next.js instance under PM2
// (`next start`), so a process-local window is an adequate guard:
// it needs no external Redis and is fail-safe (an overloaded table
// fails OPEN rather than blocking legitimate customers).
//
// NOTE: if the app is ever scaled to multiple Node processes, this
// module must be replaced by a shared store (Redis). For the current
// single-instance deployment it is intentionally dependency-free.
// ============================================================

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Cap the table so a distributed/forged set of IPs cannot grow memory
// without bound. When the cap is reached we sweep expired entries and,
// if still over, fail OPEN (never block the whole app).
const MAX_BUCKETS = 20_000;
const SWEEP_INTERVAL_MS = 60_000;

let lastSweepAt = Date.now();

function sweepExpired(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Throws RateLimitError (HTTP 429) when `key` exceeds `limit` requests
 * within `windowMs`. Otherwise records/updates the bucket and returns.
 */
export function assertRateLimit(
  key: string,
  limit: number,
  windowMs: number
): void {
  const now = Date.now();
  sweepExpired(now);

  if (buckets.size >= MAX_BUCKETS) {
    // Fail open under pathological memory pressure.
    return;
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    throw new RateLimitError();
  }
}

/**
 * Best-effort client identifier from the reverse-proxy headers.
 * Cloudflare sets CF-Connecting-IP; otherwise fall back to the first
 * X-Forwarded-For hop, then X-Real-IP, then a shared bucket.
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * Convenience: build a namespaced rate-limit key for an endpoint + IP.
 */
export function rateLimitKey(route: string, request: Request): string {
  return `${route}:${clientIp(request)}`;
}