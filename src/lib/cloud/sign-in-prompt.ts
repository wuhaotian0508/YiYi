import { getCloudSession, hasCloudCallbackParameters } from "@/lib/cloud/auth";
import { cloudConfiguration } from "@/lib/cloud/supabase-client";
import { getCloudSignInPromptDismissed } from "@/lib/storage/db";

/**
 * Cloud sync stays optional, so the prompt is a soft gate: it only appears when
 * signing in can actually succeed. Anything that would turn it into a dead end
 * — no configuration, no network, an existing session, a previous dismissal, or
 * an unreachable Supabase — lets the route through untouched.
 *
 * A landing that still carries Magic Link parameters is left alone: the page
 * itself redeems the code, and redirecting first would strip it from the URL.
 */
export async function shouldPromptCloudSignIn(): Promise<boolean> {
  if (!cloudConfiguration().configured) return false;
  if (hasCloudCallbackParameters()) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  if (await getCloudSignInPromptDismissed()) return false;
  try {
    return (await getCloudSession()) === null;
  } catch {
    return false;
  }
}
