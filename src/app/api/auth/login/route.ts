import { NextRequest, NextResponse } from "next/server";
import { signIn } from "@/lib/auth";
import {
  authenticateLogin,
  LOGIN_MESSAGES,
  resolveLoginScope,
} from "@/lib/login-scope";

/**
 * POST /api/auth/login
 *
 * Host-aware staff/owner login. Reads `x-forwarded-host` / `host`, applies the
 * strict subdomain rules (see `@/lib/login-scope`) and only then creates the
 * Auth.js session through `signIn("credentials")`, so the cookie is issued by
 * the same Auth.js instance every other route reads.
 *
 *   200 { success: true, data: { role, restaurantSlug, redirectUrl, scope } }
 *   400 missing email/password
 *   401 wrong credentials
 *   403 wrong tenant / inactive tenant / staff on the root domain
 *   404 unknown store subdomain
 *
 * The Auth.js callback (`authorize()` in `@/lib/auth`) runs the SAME policy,
 * so posting to /api/auth/callback/credentials directly cannot bypass these
 * rules.
 */
export async function POST(request: NextRequest) {
  let payload: { email?: unknown; password?: unknown };
  try {
    payload = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: LOGIN_MESSAGES.missingFields,
        error: "VALIDATION_ERROR",
      },
      { status: 400 }
    );
  }

  const email = typeof payload.email === "string" ? payload.email : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const scope = resolveLoginScope(request.headers);

  const outcome = await authenticateLogin({
    email,
    password,
    scope,
    headers: request.headers,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { success: false, message: outcome.message, error: outcome.code },
      { status: outcome.status }
    );
  }

  try {
    // `redirect: false` — this route returns JSON; the caller decides whether
    // to navigate (the owner redirect may point at another subdomain).
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    console.error("POST /api/auth/login — session creation failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Gagal membuat sesi login. Silakan coba lagi.",
        error: "SESSION_ERROR",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Login berhasil",
    data: {
      role: outcome.user.role,
      restaurantSlug: outcome.user.restaurantSlug,
      redirectUrl: outcome.redirectUrl,
      scope: scope.kind,
    },
  });
}
