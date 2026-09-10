"use client";

import { useMemo } from "react";
import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBranchContext } from "@/hooks/use-branch-context";

// ============================================================
// Report branch filter — bound to the branch context so selecting a
// branch here keeps the axios `x-branch-id` header in sync (the server
// re-validates it against the user's assignments; the header remains a
// hint, never an authorization boundary). "Semua Cabang" is offered only
// to non-scoped users; branch-scoped users (e.g. kasir) can only switch
// between the branches they are assigned to.
// ============================================================

export function ReportBranchFilter() {
  const { session, branchId, branches, isLoading, setBranchId } =
    useBranchContext();

  const canPickAll = useMemo(
    () => !!session && session.branchScoped === false,
    [session]
  );

  if (!session || isLoading) return null;

  const value = branchId ?? (canPickAll ? "ALL" : branches[0]?.id ?? "ALL");
  const hasOptions = branches.length > 0;

  return (
    <div className="flex items-center gap-2">
      <Building2 className="h-4 w-4 shrink-0 text-gray-400" />
      <Select
        value={value}
        onValueChange={(v) => setBranchId(v === "ALL" ? null : v)}
      >
        <SelectTrigger className="w-auto min-w-[150px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {canPickAll && (
            <SelectItem value="ALL">Semua Cabang</SelectItem>
          )}
          {hasOptions &&
            branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name} ({b.code})
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}