import { redirect } from "next/navigation";
import { requireRoles } from "@/lib/auth-helpers";

/**
 * Page-level role gate for the audit-log viewer.
 *
 * The API is already ADMIN-only, so a CASHIER could previously still receive
 * the page shell and only see the 403 error state. This server component
 * segment layout reuses the SAME authoritative guard the API uses
 * (`requireRoles`, which also re-checks the DB user, `isActive`,
 * `sessionVersion` and the branch hint), so a non-ADMIN never gets the shell.
 *
 * `redirect("/admin/dashboard")` is called OUTSIDE the try/catch because it
 * signals via a thrown NEXT_REDIRECT error that must not be swallowed.
 * No global middleware change, no new auth/RBAC system.
 */
export default async function AuditLogsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let allowed = true;
  try {
    await requireRoles(["ADMIN"]);
  } catch {
    allowed = false;
  }

  if (!allowed) {
    redirect("/admin/dashboard");
  }

  return <>{children}</>;
}
