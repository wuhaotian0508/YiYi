# YiYi release threat model

**Scope:** iPhone browser, Next/Vercel routes, IndexedDB, OpenAI, Photoroom,
Open-Meteo and Upstash. Mapping baseline: OWASP ASVS 5.0.0.

| Asset / boundary | Primary risk | Enforced control | Verification |
|---|---|---|---|
| Server provider keys | client or log disclosure | server-only env access; structured redacted diagnostics; secret scan | build, grep, route fault tests |
| Public paid routes | cost abuse | Upstash required in live production; fail closed when absent/unavailable; bounded requests and zero SDK retry | rate-limit and load tests |
| Wardrobe upload | spoofed/decompression image | byte cap, explicit magic brands, decodable single frame, 60 MP and dimension caps | upload-boundary tests |
| Ranking board | forged Data URL/provider abuse | strict schema, MIME prefix, decoded magic and exact byte count | ranking-api tests |
| Model output | injected/invalid IDs or schema | Zod Structured Output wire schema plus canonical validation and reference validation | provider and ranking tests |
| Browser state | cross-site embedding/script injection | CSP, frame denial, no-sniff, same-origin opener, restrictive permissions | header E2E |
| Personal data | incomplete reset/demo leakage | provenance isolation and deletion of all YiYi IndexedDB tables/storage keys | migration and reset tests |

Accepted RC constraints: the static CSP permits inline Next bootstrap/style content to
avoid nonce middleware forcing all routes dynamic. It forbids third-party scripts,
objects, frames and unlisted network origins. No analytics or persistent user identifier
is introduced.
