import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type CloudConfiguration =
  | { configured: true; url: string; key: string }
  | { configured: false; reason: "missing_configuration" };

let client: SupabaseClient | null | undefined;

export function cloudConfiguration(input = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
}): CloudConfiguration {
  const url = input.url.trim();
  const key = input.key.trim();
  return url && key ? { configured: true, url, key } : { configured: false, reason: "missing_configuration" };
}

export function getSupabaseClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (client !== undefined) return client;
  const configuration = cloudConfiguration();
  client = configuration.configured
    ? createClient(configuration.url, configuration.key, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true },
    })
    : null;
  return client;
}
