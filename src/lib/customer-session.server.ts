import crypto from "crypto";
import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/errors";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_MAX_AGE,
} from "@/lib/customer-session";

// ============================================================
// Server-side customer session (node crypto).
//
// Stateless signed token (HMAC-SHA256) in an httpOnly cookie. Separate
// from the staff NextAuth session — see customer-session.ts for why.
// ============================================================

interface CustomerSessionPayload {
  customerId: string;
  restaurantId: string;
  iat: number;
  exp: number;
}

function sessionSecret(): string {
  const secret =
    process.env.CUSTOMER_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "CUSTOMER_SESSION_SECRET (or AUTH_SECRET/NEXTAUTH_SECRET) is not configured"
    );
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * Create a signed customer session token for the given customer.
 */
export function createCustomerSessionToken(
  customerId: string,
  restaurantId: string
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: CustomerSessionPayload = {
    customerId,
    restaurantId,
    iat: now,
    exp: now + CUSTOMER_SESSION_MAX_AGE,
  };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

/**
 * Verify a customer session token (signature + expiry).
 * Throws UnauthorizedError when invalid or expired.
 */
export function verifyCustomerSessionToken(token: string): CustomerSessionPayload {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    throw new UnauthorizedError("Sesi customer tidak valid");
  }
  const expected = sign(encoded);
  // Timing-safe comparison.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new UnauthorizedError("Sesi customer tidak valid");
  }

  let payload: CustomerSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new UnauthorizedError("Sesi customer tidak valid");
  }

  if (!payload.customerId || !payload.restaurantId) {
    throw new UnauthorizedError("Sesi customer tidak valid");
  }
  if (Math.floor(Date.now() / 1000) > payload.exp) {
    throw new UnauthorizedError("Sesi customer kedaluwarsa");
  }
  return payload;
}

/** Extract + verify the customer session from a request's cookies. */
export function getCustomerSessionFromRequest(
  request: Request
): CustomerSessionPayload {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CUSTOMER_SESSION_COOKIE}=`))
    ?.slice(CUSTOMER_SESSION_COOKIE.length + 1);
  if (!token) {
    throw new UnauthorizedError("Login customer diperlukan");
  }
  return verifyCustomerSessionToken(decodeURIComponent(token));
}

/**
 * Soft variant: returns the verified customer session when a valid cookie
 * is present, otherwise null (never throws). Used by public endpoints that
 * optionally personalize (recommendations, promo list claimed state).
 */
export function tryGetCustomerSessionFromRequest(
  request: Request
): CustomerSessionPayload | null {
  try {
    return getCustomerSessionFromRequest(request);
  } catch {
    return null;
  }
}

/** Attach the customer session cookie to a response. */
export function setCustomerSessionCookie(
  response: NextResponse,
  token: string
): NextResponse {
  response.cookies.set(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_SESSION_MAX_AGE,
  });
  return response;
}

/** Clear the customer session cookie. */
export function clearCustomerSessionCookie(
  response: NextResponse
): NextResponse {
  response.cookies.set(CUSTOMER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}