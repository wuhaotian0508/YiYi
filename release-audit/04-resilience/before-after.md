# Task 4 — Before / after

| Boundary | Before | After |
|---|---|---|
| Upstash unavailable | Rejected promise could escape the route | Paid routes fail closed with labeled `503 RATE_LIMIT_UNAVAILABLE` |
| OpenAI retry count | SDK default: up to 2 hidden retries | Exactly 0 SDK retries; one paid call per attempt |
| Terra schema | Zod transform threw before the request | Plain provider contract compiles; canonical validation remains authoritative |
| Provider failures | Partial route coverage and ambiguous outer errors | 401, timeout, malformed image/output and limiter failure have permanent fault tests |
| Local burst | No encoded baseline | 24 concurrent weather requests: 0 failures, p95 53.61 ms; token burst enforces 10/hour |

The load suite targets local/mock routes only. It never sends load to OpenAI,
Photoroom, Upstash, or the weather provider.
