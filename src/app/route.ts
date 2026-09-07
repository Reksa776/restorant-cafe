import { NextResponse } from "next/server";

/**
 * GET / — redirect customers to the menu.
 *
 * Implemented as a route handler (instead of a static page redirect) so the
 * 307 response carries `Cache-Control: no-store` (M9): a static prerendered
 * redirect would be cached at the edge (Cloudflare) with a one-year
 * s-maxage, risking stale redirects after routing changes.
 */
export function GET(request: Request) {
  const url = new URL("/menu", request.url);
  return NextResponse.redirect(url, {
    status: 307,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}