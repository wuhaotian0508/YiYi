type Counter = { count: number; resetsAt: number };
export type RateLimitMode = "upstash" | "per-instance";

const counters = new Map<string, Counter>();

/** Vercel's Upstash integration exposes KV_REST_*; self-managed Redis uses UPSTASH_*. */
function redisRestConfig() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN,
  };
}

function hashSource(source: string) {
  let hash = 2166136261;
  for (const character of source) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return Math.abs(hash).toString(36);
}

function requestFingerprints(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const source = forwarded || request.headers.get("x-real-ip") || "local";
  const ip = hashSource(source);
  const clientSession = request.headers.get("x-yiyi-client-session")?.trim();
  const validSession = clientSession && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientSession)
    ? hashSource(`${source}|${clientSession}`)
    : null;
  return { primary: validSession ?? ip, ip, hasSession: Boolean(validSession) };
}

export function rateLimitMode(): RateLimitMode {
  const { url, token } = redisRestConfig();
  if (url && token) return "upstash";
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
  const { url, token } = redisRestConfig();
  if (!url || !token) throw new Error("Distributed rate limiter is not configured");
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
  const fingerprints = requestFingerprints(request);
  const key = `yiyi:${bucket}:client:${fingerprints.primary}:${windowKey}`;
  const ipKey = `yiyi:${bucket}:ip:${fingerprints.ip}:${windowKey}`;
  const ipCeiling = Math.max(limit * 8, limit + 20);
  if (mode === "upstash") {
    try {
      const primary = await distributedConsume(key, limit, windowMs);
      if (!primary.allowed || !fingerprints.hasSession) return { ...primary, available: true as const };
      const ip = await distributedConsume(ipKey, ipCeiling, windowMs);
      return { allowed: ip.allowed, retryAfterSeconds: ip.retryAfterSeconds, mode, available: true as const };
    } catch {
      return { allowed: false, retryAfterSeconds: 0, mode, available: false as const };
    }
  }

  const now = Date.now();
  if (counters.size > 1_000) for (const [entryKey, counter] of counters) if (counter.resetsAt <= now) counters.delete(entryKey);
  const consume = (entryKey: string, entryLimit: number) => {
    const current = counters.get(entryKey);
    if (!current || current.resetsAt <= now) {
      counters.set(entryKey, { count: 1, resetsAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= entryLimit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1_000)) };
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
  const primary = consume(key, limit);
  if (!primary.allowed) return { ...primary, mode, available: true as const };
  if (fingerprints.hasSession) {
    const ip = consume(ipKey, ipCeiling);
    if (!ip.allowed) return { ...ip, mode, available: true as const };
  }
  return { allowed: true, retryAfterSeconds: 0, mode, available: true as const };
}
