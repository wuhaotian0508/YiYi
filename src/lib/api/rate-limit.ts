type Counter = { count: number; resetsAt: number };
export type RateLimitMode = "upstash" | "per-instance";

const counters = new Map<string, Counter>();

function fingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const source = forwarded || request.headers.get("x-real-ip") || "local";
  let hash = 2166136261;
  for (const character of source) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return Math.abs(hash).toString(36);
}

export function rateLimitMode(): RateLimitMode {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "upstash";
  return "per-instance";
}

export function productionProtectionReady() {
  return rateLimitMode() !== "per-instance";
}

export function providerRoutesAllowed() {
  const providerLive = process.env.AI_MODE === "live" || process.env.NEXT_PUBLIC_VOICE_MODE === "live";
  return process.env.VERCEL_ENV !== "production" || !providerLive || productionProtectionReady();
}

async function distributedConsume(key: string, limit: number, windowMs: number) {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([["INCR", key], ["PEXPIRE", key, windowMs, "NX"], ["PTTL", key]]),
    cache: "no-store",
    signal: AbortSignal.timeout(2_500),
  });
  if (!response.ok) throw new Error("Distributed rate limiter unavailable");
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Invalid distributed rate-limit response");
  const count = Number((payload[0] as { result?: unknown } | undefined)?.result);
  const ttl = Number((payload[2] as { result?: unknown } | undefined)?.result);
  if (!Number.isFinite(count)) throw new Error("Invalid distributed rate-limit count");
  return { allowed: count <= limit, retryAfterSeconds: count <= limit ? 0 : Math.max(1, Math.ceil((Number.isFinite(ttl) ? ttl : windowMs) / 1_000)), mode: "upstash" as const };
}

export async function takeRateLimit(request: Request, bucket: string, limit: number, windowMs = 60 * 60 * 1000) {
  const mode = rateLimitMode();
  const windowKey = Math.floor(Date.now() / windowMs);
  const key = `yiyi:${bucket}:${fingerprint(request)}:${windowKey}`;
  if (mode === "upstash") return distributedConsume(key, limit, windowMs);

  const now = Date.now();
  if (counters.size > 1_000) for (const [entryKey, counter] of counters) if (counter.resetsAt <= now) counters.delete(entryKey);
  const current = counters.get(key);
  if (!current || current.resetsAt <= now) {
    counters.set(key, { count: 1, resetsAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0, mode };
  }
  if (current.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1_000)), mode };
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0, mode };
}
