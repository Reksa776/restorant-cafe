"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Loader2 } from "lucide-react";
import { useBranchContext } from "@/hooks/use-branch-context";
import { FloorLayoutEditor } from "@/components/admin/table-layout/floor-layout-editor";

/**
 * Admin/Cashier floor layout editor — visual arrangement of tables per branch.
 *
 * The layout is a VISUAL LAYER: Table rows stay the source of truth (existing
 * Table CRUD on /admin/tables is reused for create; this page only arranges
 * placed geometries). The active branch comes from the existing admin branch
 * context / selector (never re-implemented here).
 */
export default function TableLayoutPage() {
  const { branches, branchId, isLoading: branchCtxLoading } = useBranchContext();

  const effectiveBranch = useMemo(() => {
    if (branchId) return branches.find((branch) => branch.id === branchId) ?? null;
    // Single-branch restaurants shouldn't have to pick a branch manually.
    if (branches.length === 1) return branches[0];
    return null;
  }, [branchId, branches]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Layout Cafe</h1>
        <p className="text-gray-500">
          Susun meja secara visual di canvas. Meja tetap dikelola lewat halaman
          Meja.
        </p>
      </div>

      {branchCtxLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Memuat cabang…
          </CardContent>
        </Card>
      ) : !effectiveBranch ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Building2 className="h-8 w-8 text-gray-300" />
            <p className="text-base font-medium text-gray-800">
              Pilih cabang terlebih dahulu
            </p>
            <p className="max-w-md text-sm text-gray-500">
              Layout disusun per cabang. Gunakan pemilih cabang di pojok kanan
              atas untuk memilih satu cabang.
            </p>
          </CardContent>
        </Card>
      ) : (
        <FloorLayoutEditor
          branchId={effectiveBranch.id}
          branchCode={effectiveBranch.code}
          branchName={effectiveBranch.name}
        />
      )}
    </div>
  );
}