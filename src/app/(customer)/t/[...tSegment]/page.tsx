import { notFound } from "next/navigation";
import TableLanding from "../table-landing";

// Unified table URL handler covering BOTH forms:
//   /t/{branchCode}/{tableNumber}  (multi-branch QR, preferred)
//   /t/{tableNumber}               (legacy QR, branchCode = null)
//
// Next.js forbids different dynamic slug names at the same segment level, so
// the two former routes (`[tableNumber]` and `[branchCode]/[tableNumber]`)
// cannot coexist. A single catch-all preserves both URL shapes unchanged.
export default async function TableSegmentPage({
  params,
}: {
  params: Promise<{ tSegment: string[] }>;
}) {
  const { tSegment } = await params;
  if (tSegment.length === 1) {
    return (
      <TableLanding tableNumberParam={tSegment[0]} branchCodeParam={null} />
    );
  }
  if (tSegment.length === 2) {
    return (
      <TableLanding
        tableNumberParam={tSegment[1]}
        branchCodeParam={tSegment[0]}
      />
    );
  }
  notFound();
}