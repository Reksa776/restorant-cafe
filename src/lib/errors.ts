export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number = 500, code: string = "INTERNAL_ERROR") {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Validation failed") {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  /**
   * A 409 with an optional semantic `code`. The default stays `CONFLICT` so
   * every existing caller is unchanged; a more specific code (e.g.
   * `TABLE_NOT_AVAILABLE` for the reservation table gate) lets the client show
   * a targeted message without changing the HTTP status or error envelope.
   */
  constructor(
    message: string = "Resource already exists",
    code: string = "CONFLICT"
  ) {
    super(message, 409, code);
    this.name = "ConflictError";
  }
}

/**
 * The acting user is a CASHIER and has no OPEN shift for the branch the
 * transaction would be written to. Keep this distinct from the generic
 * CONFLICT code so the frontend can show "Shift belum dibuka" with a
 * "Buka Shift" action instead of a generic error. 409 matches the previous
 * inline ConflictError status so no existing client depends on a different
 * HTTP code for this failure.
 */
export class ShiftNotOpenError extends AppError {
  constructor(
    message: string =
      "Shift belum dibuka. Silakan buka shift terlebih dahulu untuk memproses transaksi."
  ) {
    super(message, 409, "SHIFT_NOT_OPEN");
    this.name = "ShiftNotOpenError";
  }
}

/**
 * H1 — ingredient (BOM) consumption engine failures.
 *
 * Order completion is DECOUPLED from ingredient stock: READY → COMPLETED no
 * longer calls `consumeOrderIngredients()` (recipe/HPP/ingredient stock can
 * never block it). The engine is retained for dedicated inventory workflows,
 * and its distinct `code`s let such a caller explain the exact blocker:
 *   INGREDIENT_NOT_FOUND          — recipe references an ingredient that is gone
 *   INGREDIENT_INACTIVE           — recipe references a deactivated ingredient
 *   INSUFFICIENT_INGREDIENT_STOCK — branch stock < required consumption
 *
 * A missing/inactive/empty base recipe is NO LONGER thrown (resep/HPP are
 * optional): INGREDIENT_RECIPE_REQUIRED / INGREDIENT_RECIPE_INACTIVE are
 * retained for compatibility only.
 *
 * 409 matches the product-stock insufficiency (ConflictError) HTTP semantics;
 * the `code` differentiates.
 */
export class IngredientCompletionError extends AppError {
  constructor(code: string, message: string) {
    super(message, 409, code);
    this.name = "IngredientCompletionError";
  }
}

export class PaymentError extends AppError {
  constructor(message: string = "Payment failed") {
    super(message, 422, "PAYMENT_ERROR");
    this.name = "PaymentError";
  }
}

export class WhatsAppError extends AppError {
  constructor(message: string = "WhatsApp error") {
    super(message, 500, "WHATSAPP_ERROR");
    this.name = "WhatsAppError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Too many requests, please try again later") {
    super(message, 429, "RATE_LIMITED");
    this.name = "RateLimitError";
  }
}
