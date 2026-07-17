type Counter = { count: number; resetsAt: number };

const counters = new Map<string, Counter>();

function fingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const source = forwarded || request.headers.get("x-real-ip") || "local";
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash).toString(36);
}

export function takeRateLimit(request: Request, bucket: string, limit: number, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  if (counters.size > 1_000) {
    for (const [key, counter] of counters) if (counter.resetsAt <= now) counters.delete(key);
  }
  const key = `${bucket}:${fingerprint(request)}`;
  const current = counters.get(key);
  if (!current || current.resetsAt <= now) {
    counters.set(key, { count: 1, resetsAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1_000)) };
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
