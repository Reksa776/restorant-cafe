import { NextResponse } from "next/server";

interface SuccessResponse<T = unknown> {
  success: true;
  message: string;
  data: T;
}

interface ErrorResponse {
  success: false;
  message: string;
  error: string;
}

interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function successResponse<T>(data: T, message: string = "Success", status: number = 200) {
  const body: SuccessResponse<T> = {
    success: true,
    message,
    data,
  };
  return NextResponse.json(body, { status });
}

export function createdResponse<T>(data: T, message: string = "Created successfully") {
  return successResponse(data, message, 201);
}

export function errorResponse(message: string, error: string = "ERROR", status: number = 500) {
  const body: ErrorResponse = {
    success: false,
    message,
    error,
  };
  return NextResponse.json(body, { status });
}

export function paginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
  message: string = "Success"
) {
  const data: PaginatedData<T> = {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
  return successResponse(data, message);
}
