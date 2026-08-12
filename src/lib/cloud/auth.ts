import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/cloud/supabase-client";

export async function getCloudSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function subscribeToCloudAuth(listener: (event: AuthChangeEvent, session: Session | null) => void) {
  const client = getSupabaseClient();
  if (!client) return () => undefined;
  const { data } = client.auth.onAuthStateChange(listener);
  return () => data.subscription.unsubscribe();
}

export async function sendMagicLink(email: string, redirectTo: string) {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) throw new Error("Enter an email address to continue.");
  const client = getSupabaseClient();
  if (!client) throw new Error("Cloud sync is not configured.");
  const { error } = await client.auth.signInWithOtp({ email: normalizedEmail, options: { emailRedirectTo: redirectTo } });
  if (error) throw error;
}

/**
 * Google returns the same PKCE `code` a Magic Link does, so the callback path
 * is unchanged — only the way the code is requested differs. Supabase performs
 * the redirect itself, so this resolves only when the handoff fails.
 */
export async function signInWithGoogle(redirectTo: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Cloud sync is not configured.");
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  if (error) throw error;
}

const callbackParameters = ["access_token", "code", "error", "error_code", "error_description", "expires_at", "expires_in", "provider_token", "refresh_token", "state", "token_hash", "token_type", "type"];

const CallbackParameterSchema = z.object({
  code: z.string().trim().min(1).max(4_096).nullable(),
  accessToken: z.string().trim().min(1).max(16_384).nullable(),
  refreshToken: z.string().trim().min(1).max(16_384).nullable(),
  tokenHash: z.string().trim().min(1).max(4_096).nullable(),
  type: z.enum(["email", "magiclink", "signup", "invite"]).nullable(),
  failure: z.string().trim().min(1).max(500).nullable(),
}).strict();

type CloudCallback =
  | { kind: "code"; code: string }
  | { kind: "session_tokens"; accessToken: string; refreshToken: string }
  | { kind: "token_hash"; tokenHash: string; type: "email" | "magiclink" | "signup" | "invite" }
  | { kind: "failure"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "none" };

function firstParameter(query: URLSearchParams, hash: URLSearchParams, key: string) {
  return query.get(key) ?? hash.get(key);
}

function callbackValues(): CloudCallback {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const rawType = firstParameter(query, hash, "type");
  const parsed = CallbackParameterSchema.safeParse({
    code: firstParameter(query, hash, "code"),
    accessToken: firstParameter(query, hash, "access_token"),
    refreshToken: firstParameter(query, hash, "refresh_token"),
    tokenHash: firstParameter(query, hash, "token_hash"),
    type: rawType,
    failure: firstParameter(query, hash, "error_description") ?? firstParameter(query, hash, "error"),
  });
  if (!parsed.success) {
    const hasCallback = callbackParameters.some((key) => query.has(key) || hash.has(key));
    return hasCallback
      ? { kind: "invalid", message: "That sign-in link has invalid callback parameters. Request a new one." }
      : { kind: "none" };
  }
  if (parsed.data.failure) return { kind: "failure", message: parsed.data.failure };
  if (parsed.data.code) return { kind: "code", code: parsed.data.code };
  if (parsed.data.accessToken && parsed.data.refreshToken) {
    return { kind: "session_tokens", accessToken: parsed.data.accessToken, refreshToken: parsed.data.refreshToken };
  }
  if (parsed.data.accessToken || parsed.data.refreshToken) {
    return { kind: "invalid", message: "That sign-in link returned an incomplete session. Request a new one." };
  }
  if (parsed.data.tokenHash && parsed.data.type) {
    return { kind: "token_hash", tokenHash: parsed.data.tokenHash, type: parsed.data.type };
  }
  if (parsed.data.tokenHash || rawType) {
    return { kind: "invalid", message: "That sign-in link is incomplete. Request a new one." };
  }
  return { kind: "none" };
}

/** A landing that carries a callback must not be redirected away before it is redeemed. */
export function hasCloudCallbackParameters() {
  if (typeof window === "undefined") return false;
  return callbackValues().kind !== "none";
}

/**
 * Supabase can fall back to the configured site URL when a requested redirect
 * is not allow-listed. Preserve the one-time callback when that site URL is
 * the app root instead of letting the route gate discard it on the way to
 * Today.
 */
export function rootCloudCallbackDestination(pathname: string) {
  if (pathname !== "/" || typeof window === "undefined" || !hasCloudCallbackParameters()) return null;
  return `/sign-in${window.location.search}${window.location.hash}`;
}

/** Redeemed codes are single-use, so the parameters must not survive a reload. */
function clearCallbackParameters() {
  const url = new URL(window.location.href);
  for (const key of callbackParameters) url.searchParams.delete(key);
  url.hash = "";
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

export type CloudSignInOutcome =
  | { status: "signed_in"; session: Session }
  | { status: "no_callback" }
  | { status: "failed"; message: string };

/**
 * Supabase reports callback failures as URL parameters rather than as a thrown
 * error — an expired or already-consumed link looks identical to never having
 * signed in. Redeeming the code explicitly, instead of leaving it to
 * detectSessionInUrl, is what makes those failures reportable.
 */
export async function completeCloudSignIn(): Promise<CloudSignInOutcome> {
  const client = getSupabaseClient();
  if (!client) return { status: "no_callback" };
  const callback = callbackValues();
  if (callback.kind === "none") return { status: "no_callback" };
  if (callback.kind === "failure" || callback.kind === "invalid") {
    clearCallbackParameters();
    return { status: "failed", message: callback.message };
  }
  try {
    const { data, error } = callback.kind === "code"
      ? await client.auth.exchangeCodeForSession(callback.code)
      : callback.kind === "session_tokens"
        ? await client.auth.setSession({ access_token: callback.accessToken, refresh_token: callback.refreshToken })
        : await client.auth.verifyOtp({ token_hash: callback.tokenHash, type: callback.type });
    clearCallbackParameters();
    if (error) return { status: "failed", message: error.message };
    if (!data.session) return { status: "failed", message: "That sign-in link did not return a session. Request a new one." };
    return { status: "signed_in", session: data.session };
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : "That sign-in link could not be completed." };
  }
}

export async function signOutCloud() {
  const client = getSupabaseClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}
