import { NextResponse } from "next/server";

export function noStoreJson<T>(body: T, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0", ...Object.fromEntries(new Headers(headers)) } });
}

export function apiError(requestId: string, status: number, code: string, message: string, retryable = false, headers?: HeadersInit) {
  return noStoreJson({ requestId, error: { code, message, retryable } }, status, headers);
}
