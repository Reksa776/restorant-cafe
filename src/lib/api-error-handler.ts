"use client";

/**
 * Client-side API error normalization.
 *
 * Maps an axios/HTTP error to a stable user-facing message so the UI never
 * renders a raw `AxiosError`. Distinguishes the status classes that matter:
 *
 *   401  → session already expired → route through the existing axios 401
 *         recovery (redirect to /login). The caller should NOT render this
 *         as a widget error since the interceptor will bounce the user.
 *   403  → authenticated but not authorized for the requested branch/scope.
 *         Never auto-switch branch and never retry; the user must pick a
 *         branch they are authorized for (or the branch context is stale).
 *   404  → resource not found.
 *   429  → rate limited → transient, retry allowed.
 *   5xx / network → server/connectivity problem → transient, retry allowed.
 *
 * The distinction between 403 and an empty result set is preserved: a 403 is
 * a hard authorization failure (never shown as "no data").
 */

export interface NormalizedApiError {
  status: number | null;
  message: string;
  retryable: boolean;
  kind: "auth" | "forbidden" | "not_found" | "rate_limit" | "server" | "network" | "unknown";
}

/**
 * Extract the HTTP status and server message from an axios error (or a plain
 * error). Falls back gracefully when the error has no response/status.
 */
export function getErrorStatus(error: unknown): number | null {
  // Axios errors carry error.response?.status and error.response?.data.
  const err = error as {
    response?: { status?: number; data?: { message?: string } };
    status?: number;
    message?: string;
  };
  return err?.response?.status ?? err?.status ?? null;
}

export function getErrorMessage(error: unknown): string | null {
  const err = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return err?.response?.data?.message ?? null;
}

/**
 * The semantic error code from the standard `{ success, message, error }`
 * envelope (`response.data.error`), e.g. "SHIFT_NOT_OPEN", "ALREADY_PAID",
 * "FORBIDDEN". Returns null when the error has no server envelope.
 */
export function getErrorCode(error: unknown): string | null {
  const err = error as {
    response?: { data?: { error?: string } };
  };
  return err?.response?.data?.error ?? null;
}

/**
 * True when the backend rejected the operation because the acting CASHIER has
 * no OPEN shift for the target branch. Drives the "Shift belum dibuka" toast
 * with a "Buka Shift" action instead of a generic error.
 */
export function isShiftNotOpen(error: unknown): boolean {
  return getErrorCode(error) === "SHIFT_NOT_OPEN";
}

/** True when the error is a 403 authorization failure (hard, non-retryable). */
export function isForbidden(error: unknown): boolean {
  return getErrorStatus(error) === 403;
}

/** True when the error is a 401 session-expired failure. */
export function isUnauthorized(error: unknown): boolean {
  return getErrorStatus(error) === 401;
}

/**
 * Normalize an error into a stable, UI-safe shape with a user-facing message.
 *
 * `retryable` tells the caller whether "Coba Lagi" / automatic retry is safe
 * (transient 429/5xx/network) versus a hard 403/404 that must not retry.
 */
export function normalizeApiError(error: unknown): NormalizedApiError {
  const status = getErrorStatus(error);
  const serverMessage = getErrorMessage(error);

  if (status === 401) {
    return {
      status: 401,
      message: "Sesi login sudah berakhir. Silakan login kembali.",
      retryable: false,
      kind: "auth",
    };
  }

  if (status === 403) {
    return {
      status: 403,
      message:
        serverMessage ||
        "Anda tidak memiliki akses ke cabang ini. Silakan pilih cabang yang sesuai dengan akun Anda.",
      retryable: false,
      kind: "forbidden",
    };
  }

  if (status === 404) {
    return {
      status: 404,
      message: "Data tidak ditemukan.",
      retryable: false,
      kind: "not_found",
    };
  }

  if (status === 429) {
    return {
      status: 429,
      message: "Terlalu banyak permintaan. Silakan coba lagi beberapa saat.",
      retryable: true,
      kind: "rate_limit",
    };
  }

  if (status !== null && status >= 500) {
    return {
      status,
      message: "Server sedang mengalami gangguan. Silakan coba lagi.",
      retryable: true,
      kind: "server",
    };
  }

  // Network error (no response) or anything else.
  return {
    status: status ?? null,
    message: "Koneksi bermasalah. Silakan periksa internet Anda dan coba lagi.",
    retryable: true,
    kind: "network",
  };
}
