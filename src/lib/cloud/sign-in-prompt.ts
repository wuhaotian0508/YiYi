import { getCloudSession } from "@/lib/cloud/auth";
import { cloudConfiguration } from "@/lib/cloud/supabase-client";
import { getCloudSignInPromptDismissed } from "@/lib/storage/db";

/**
 * Cloud sync stays optional, so the prompt is a soft gate: it only appears when
 * signing in can actually succeed. Anything that would turn it into a dead end
 * — no configuration, no network, an existing session, a previous dismissal, or
 * an unreachable Supabase — lets the route through untouched.
 *
 * getCloudSession awaits client initialisation, which is what exchanges a
 * `?code=` Magic Link parameter for a session. Calling it here means a route
 * landed on straight from an email link resolves its session before this
 * decides whether to redirect.
 */
export async function shouldPromptCloudSignIn(): Promise<boolean> {
  if (!cloudConfiguration().configured) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  if (await getCloudSignInPromptDismissed()) return false;
  try {
    return (await getCloudSession()) === null;
  } catch {
    return false;
  }
}
