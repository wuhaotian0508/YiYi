import { NextResponse } from "next/server";

export function noStoreJson<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export function apiError(requestId: string, status: number, code: string, message: string, retryable = false) {
  return noStoreJson({ requestId, error: { code, message, retryable } }, status);
}
