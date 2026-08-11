import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { cloudConfiguration } from "@/lib/cloud/supabase-client";

const MAX_BEARER_TOKEN_LENGTH = 4_096;
const bearerTokenSchema = z
  .string()
  .min(1)
  .max(MAX_BEARER_TOKEN_LENGTH)
  .regex(/^[A-Za-z0-9._~+/-]+=*$/);
const verifiedEmailSchema = z.string().trim().toLowerCase().email();

export type VerifiedCloudUser =
  | { ok: true; email: string }
  | { ok: false; code: "UNAUTHORIZED" | "CLOUD_NOT_CONFIGURED" };

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.*)$/i);
  if (!match) return null;

  const parsed = bearerTokenSchema.safeParse(match[1]);
  return parsed.success ? parsed.data : null;
}

export async function verifiedCloudUser(request: Request): Promise<VerifiedCloudUser> {
  const token = bearerToken(request);
  if (!token) return { ok: false, code: "UNAUTHORIZED" };

  const configuration = cloudConfiguration();
  if (!configuration.configured) return { ok: false, code: "CLOUD_NOT_CONFIGURED" };

  try {
    const client = createClient(configuration.url, configuration.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return { ok: false, code: "UNAUTHORIZED" };

    const email = verifiedEmailSchema.safeParse(data.user.email);
    return email.success
      ? { ok: true, email: email.data }
      : { ok: false, code: "UNAUTHORIZED" };
  } catch {
    return { ok: false, code: "UNAUTHORIZED" };
  }
}
