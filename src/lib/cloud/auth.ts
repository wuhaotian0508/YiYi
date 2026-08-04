import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
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

const callbackParameters = ["code", "error", "error_code", "error_description", "state", "token_hash", "type"];

function callbackValues() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return {
    code: query.get("code") ?? hash.get("code"),
    failure: query.get("error_description") ?? query.get("error") ?? hash.get("error_description") ?? hash.get("error"),
  };
}

/** A landing that carries a callback must not be redirected away before it is redeemed. */
export function hasCloudCallbackParameters() {
  if (typeof window === "undefined") return false;
  const { code, failure } = callbackValues();
  return Boolean(code || failure);
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
  if (!client || !hasCloudCallbackParameters()) return { status: "no_callback" };
  const { code, failure } = callbackValues();
  clearCallbackParameters();
  if (failure) return { status: "failed", message: failure };
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code as string);
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
