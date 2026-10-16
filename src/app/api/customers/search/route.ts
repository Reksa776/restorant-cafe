import { NextRequest } from "next/server";
import { customerService } from "@/services/customer/customer.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

/** Limited POS lookup for order entry; full CRM listing remains admin-only. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchHintFrom(request));
    const search = request.nextUrl.searchParams.get("search") || "";
    const customers = await customerService.searchForOrder(
      ctx.restaurantId,
      search,
      authorizedBranches(ctx)
    );
    return successResponse(customers);
  } catch (error) {
    if (error instanceof AppError) return errorResponse(error.message, error.code, error.statusCode);
    console.error("Error searching order customers:", error);
    return errorResponse("Gagal mencari pelanggan", "INTERNAL_ERROR", 500);
  }
}
