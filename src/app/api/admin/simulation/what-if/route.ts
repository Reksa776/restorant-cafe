import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import { simulationService } from "@/services/simulation/simulation.service";
import { SimulationRequestSchema } from "@/services/simulation/simulation.types";

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Request body tidak valid");
    }

    const parsed = SimulationRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    // role + branch scoping validated here (ctx.branchId === requested branch).
    const ctx = await requireRoles(["ADMIN"], parsed.data.branchId);

    const result = await simulationService.simulateWhatIf(parsed.data, ctx);
    return successResponse(result, "Simulasi berhasil dihitung");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error running what-if simulation:", error);
    return errorResponse("Gagal menjalankan simulasi", "INTERNAL_ERROR", 500);
  }
}