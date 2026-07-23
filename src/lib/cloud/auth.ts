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

export async function signOutCloud() {
  const client = getSupabaseClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}
