# Memory and ownership audit

| Resource | Owner | Release path | Evidence |
|---|---|---|---|
| Wardrobe Blob URL | `Garment` / Add flow | cancel rAF and `revokeObjectURL` on replacement/unmount/error | source audit; page cycling E2E |
| Ranking board Blob URL | board renderer image load | revoke after load/use and on error | ranking boundary tests |
| Realtime session/media | Voice adapter + coordinator | abort token request, SDK `session.close()`, clear listeners before replacement | Voice race tests |
| Mock voice timers | Mock adapter | all timer IDs cleared on disconnect | adapter/coordinator tests |
| Bottom Sheet | component effect | stop Motion animation; remove key listener; cancel rAF; restore focus/body overflow | unit + WebKit interaction tests |
| GSAP timeline/GSDevTools | `useGSAP` / review effect | scoped cleanup and `kill()` | onboarding/motion tests |
| Swiper | Today route | React integration owns instance and track; no competing transform | WebKit gesture tests |
| UI AudioContext | app-lifetime singleton | oscillator nodes stop; master disconnects after final oscillator | intentional singleton; no per-route contexts |

No retained-object heap claim is made without Safari device tooling. The final device checklist keeps long-session heap growth and image decode pressure open for Web Inspector verification.
