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
  constructor(message: string = "Resource already exists") {
    super(message, 409, "CONFLICT");
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
