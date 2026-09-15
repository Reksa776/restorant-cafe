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
//
// Like the sidebar BranchSelector, a change triggers a full page reload.
// `useBranchContext` is NOT a React context (there is no Provider), so
// `setBranchId` only updates this component's own state + localStorage;
// other consumers (the page's data fetch, Dashboard Analytics) would never
// learn about the change. Reloading makes every page refetch scoped to the
// new branch — simple and race-free, and it is the documented behaviour.
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

  // Human-readable trigger label. Base UI renders the raw VALUE string in
  // the trigger (not the item label) while the popup is closed, so an
  // internal branch ID like "cmts3aks100009tu818hblu00" would be shown as-is
  // — expose the branch NAME instead (same format as the dropdown options).
  const selectedBranch = branches.find((b) => b.id === value);
  const triggerLabel =
    value === "ALL"
      ? "Semua Cabang"
      : selectedBranch
        ? `${selectedBranch.name} (${selectedBranch.code})`
        : "Semua Cabang";

  return (
    <div className="flex items-center gap-2">
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
        <SelectTrigger className="w-auto min-w-[150px] text-sm">
          <SelectValue>{triggerLabel}</SelectValue>
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