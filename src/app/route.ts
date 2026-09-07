import { NextResponse } from "next/server";

// Keep this route focused only on the app redirect.
// It must not hardcode the production domain; see AUDIT-LOCALHOST-REDIRECT-REPORT.md.

export function GET() {
  return NextResponse.redirect(new URL("/menu", "https://resto.demosolusisejalan.my.id"), {
    status: 307,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}