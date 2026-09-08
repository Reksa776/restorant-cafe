"use client";

import { useMemo } from "react";
import { Building2, Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useBranchContext } from "@/hooks/use-branch-context";

/**
 * Admin branch switcher. Reads the session's branch list + the stored active
 * branch (localStorage) and lets an admin with all-branch access pick
 * "Semua Cabang" (aggregated view) or a single branch. Branch-scoped users
 * (e.g. a cashier assigned to specific branches) can only switch between the
 * branches they have access to.
 *
 * The selection feeds `x-branch-id` on every admin API request via the axios
 * interceptor; the server re-validates it against the UserBranch assignments.
 */
export function BranchSelector({
  className,
}: {
  className?: string;
}) {
  const { session, branchId, branches, isLoading, setBranchId } =
    useBranchContext();

  const canPickAll = useMemo(
    () => !!session && session.branchScoped === false,
    [session]
  );

  // Hide entirely for single-branch restaurants (no switch to make).
  const visibleBranches = useMemo(
    () => (session?.branchScoped ? branches : branches),
    [session, branches]
  );
  const showSelector =
    !!session && visibleBranches.length > 1 && !isLoading;

  if (!session || !showSelector) return null;

  const value = branchId ?? (canPickAll ? "ALL" : visibleBranches[0]?.id ?? "ALL");

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Building2 className="h-4 w-4 shrink-0 text-gray-400" />
      <Select
        value={value}
        onValueChange={(v) => {
          setBranchId(v === "ALL" ? null : v);
          // Reload so every page refetches scoped to the new branch. Simple
          // and race-free — admin data is server-scoped via x-branch-id.
          window.location.reload();
        }}
      >
        <SelectTrigger className="h-9 w-auto min-w-[140px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {canPickAll && (
            <SelectItem value="ALL">
              <span className="inline-flex items-center gap-1.5">
                Semua Cabang
              </span>
            </SelectItem>
          )}
          {visibleBranches.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3 w-3 opacity-0 group-data-[state=checked]:opacity-100" />
                {b.name} ({b.code})
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}