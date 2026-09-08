// ============================================================
// Customer session — shared constants + client-side helpers.
//
// The customer auth is intentionally SEPARATE from the staff
// NextAuth session (Role ADMIN|CASHIER, /admin middleware): customers
// never touch /admin and staff never use the customer cookie.
//
// Cookie payload (server-side, see customer-session.server.ts):
//   base64url(JSON { customerId, restaurantId, iat, exp })
//   + "." + base64url(HMAC-SHA256 signature)
// The client only reads the (unsigned) payload for UX hints — every
// server endpoint re-verifies the signature + expiry.
// ============================================================

export const CUSTOMER_SESSION_COOKIE = "customer_session";
export const CUSTOMER_SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Read the customerId from the customer session cookie (client-side only).
 * Returns null when there is no cookie or the payload cannot be parsed.
 * The signature is NOT verified here — server endpoints always re-verify.
 */
export function getCustomerSessionId(): string | null {
  if (typeof window === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CUSTOMER_SESSION_COOKIE}=`));
  if (!match) return null;
  const value = match.slice(CUSTOMER_SESSION_COOKIE.length + 1);
  if (!value) return null;
  try {
    const payload = value.split(".")[0];
    if (!payload) return null;
    const parsed = JSON.parse(decodeURIComponent(atob(payload)));
    return typeof parsed.customerId === "string" ? parsed.customerId : null;
  } catch {
    return null;
  }
}