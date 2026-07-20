# Task 5 — Before / after

| Finding | Before | After |
|---|---|---|
| Upload trust boundary | broad `ftyp` acceptance; no pixel/frame geometry cap | explicit HEIC brands, decode validation, one frame, 60 MP/12k caps |
| Candidate board | prefix and caller-declared size only | exact decoded byte count and PNG/WebP magic validation |
| Browser policy | no CSP or clickjacking header | static Next-compatible CSP, DENY frames, no-sniff, COOP and permissions policy |
| Local reset | database deletion plus one storage key; UI said “demo” | all tables/blobs/jobs and all YiYi-owned web storage keys; truthful copy |
| Accessibility | serious contrast failures; focus return unproven | zero serious/critical axe findings on five routes in Chromium/WebKit; focus E2E passes |
| Dependencies/secrets | no RC evidence | production audit: zero known vulnerabilities; tracked-file secret scan: zero findings |

Remaining checks are device-bound: VoiceOver, Dynamic Type, physical touch targets,
microphone/audio routing and subjective reduced-motion comfort.
