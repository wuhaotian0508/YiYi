# YiYi Motion Acceptance Matrix

This matrix is updated with concrete evidence as implementation lands. “Automated” proves deterministic state or geometry. “Device” is the explicit iPhone/Safari check and is never inferred from desktop automation.

| Problem | Previous experience | Mature capability selected | Planned code surface | Automated evidence | iPhone/Safari verification | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Splash reading is interrupted | Uniform short timers reveal the next element before reading settles | GSAP named timeline with authored holds and indefinite Begin | Onboarding scene | Unit test forces the playhead into the pause boundary; Chromium/WebKit first-run flows click the stable action | Read at normal pace; ensure Begin never auto-advances | Passed — explicit pause-boundary regression; Device pending — reading pace |
| Old pages 2/3/4 remain | Separate teach/understand/recommend screens and route-like transitions | One GSAP conversational timeline | Root onboarding | Motion review asserts former copy, buttons, and screens are absent | Complete first run without intermediate taps | Passed — one route and one continuous scene |
| Hesitation, caret, deletion, and reframe are disconnected | Static examples and page changes | TextPlugin within one seekable timeline | Conversational scene | Named seek/restart test proves exact text, line breaks, reverse deletion, and deterministic replay | Review at 1× and 0.5× | Passed — `motion-review.spec.ts`; Device pending — subjective rhythm |
| Red/green judgment and blame copy | Exam-like cards and “You’re still choosing” | Content removal, not restyling | Copy + onboarding | Removed-copy assertions run in WebKit review | Confirm tone reads as neutral and supportive | Passed — DOM/copy assertion; Device pending — tone review |
| `Show me how` / `Continue` remain | Manual buttons split one causal explanation | Automatic named timeline | Onboarding | Controls are absent after Begin and the timeline seeks through all labels without route changes | Confirm scene progresses without taps | Passed — authored timeline contract |
| Semantics appear without source | Uniform chip stagger unrelated to speech | Timeline labels after phrase completion | Understanding sequence | Named `understanding` frame exposes only the semantics reached at that playhead | Confirm source phrase is heard/read first | Passed — named-frame assertion; Device pending — 1× comprehension |
| Outfit composition floats and crowds | Unequal assets and weak bounding axis | Normalized flat-lay slots and stable canvas | Outfit Canvas + asset styles | Four iPhone-size visual baselines and per-slot geometry | Inspect balance on four iPhone sizes | Passed — 375×667, 390×844, 393×852, 430×932 baselines; Device pending — subjective balance |
| Targeted shoe change is hard to notice | Whole canvas feels unstable; scale/y pop | Motion keyed presence inside fixed slot | Outfit Canvas | Old/new shoe lifecycle is asserted; every non-target and target slot box changes by at most 1 px | Watch at 0.5× and interrupt mid-replace | Passed — geometry/lifecycle regression; Device pending — touch interruption feel |
| White shoe contains baked ground shadow | Sprite source includes inconsistent dark floor shadow | Clean source asset + one render-layer shadow policy | Demo wardrobe asset | Clean WebP is used by the demo item and appears in visual baselines | Compare demo/user items on device | Passed — reviewed clean asset/baseline; Device pending — real user cutout comparison |
| App has multiple motion languages | CSS page arrival, timers, Motion delays, custom drag coexist | Ownership matrix + unified tokens + MotionConfig | Root + components + CSS | Source sweep clears old storyboard timers/custom page physics; normal and reduced suites pass | Cross-flow consistency review | Passed — ownership/source audit; Device pending — cross-flow feel |
| Wardrobe swipe is strict and detached | Manual `-72/-650` threshold then route push | Swiper finger tracking and mature thresholds | Today/Wardrobe shell | Long drag, short flick, diagonal drag, insufficient rebound, return, and vertical scroll are automated | Tune touch feel against real Safari | Passed — WebKit gesture behavior; Device pending — Safari touch tuning |
| Vertical scroll can conflict with page swipe | Custom horizontal drag lacks mature axis intent | Swiper `touchAngle`, threshold, edge/system settings | Pager | Explicit vertical and diagonal cases retain the correct slide | Test near Safari back edge and scroll areas | Passed — WebKit axis-intent cases; Device pending — system-edge coexistence |
| Reduced motion is incomplete | Per-component overrides and CSS animations remain | Root MotionConfig + authored equivalents + CSS media rules | Whole app | Reduced onboarding, Today, Calibration, and Fine-tune screenshots plus caret/static-state checks | iOS Reduce Motion enabled | Passed — reduced-motion suite; Device pending — iOS setting |
| Calibration/Fine-tune drift from state | Static insertion and raw-state emphasis | Motion layout/presence driven by persisted profile | Calibration/Fine-tune | A/B/Both/Neither/Skip, `object-fit: contain`, More/Less insertion and deletion, and hidden raw transcript are asserted | Voice preference chip appears after save | Passed — production-component state tests; Device pending — real voice preference |
| Animation queues survive newer actions | Delay chains and stale presence can finish late | Replace/cancel ownership and state-keyed rendering | Runtime operations | Random→Undo, speaking→interrupted, rapid recommendation mutations, and stale-operation tests | Rapid repeated touch test | Passed — interruption/state regressions; Device pending — repeated touch feel |
| Sheet and pager fight for transforms | Independent gesture implementations can overlap | Sheet disables pager; separate transform owners | Bottom Sheet + pager | Drag follow, rebound, velocity/distance close, scrim close, and pager lock are asserted | Drag sheet near page edges | Passed — WebKit sheet/pager tests; Device pending — edge feel |
| Review tooling is subjective-only | Ad-hoc waits and screenshots | Dev review route, GSDevTools, labels, frame sampler | `/motion-review` | Seven serial WebKit review tests, named artifacts, production 404, and production-chunk scan | Safari Timeline recordings | Passed — deterministic review tooling; Device pending — Safari Timelines |

## Required review rounds

### Round A — Storyboard and visual hierarchy

- Play onboarding at 1× and 0.5×.
- Seek every named label and regenerate four-viewport normal/reduced screenshots.
- Verify reading order, continuous scene, causal explanation, flat-lay balance, and safe-area composition.

### Round B — Interaction and interruption

- Record Playwright traces/videos for Swiper cases, Bottom Sheet, Voice interruption, initial/revision/random/undo/confirm, and fast repeated actions.
- Require persisted state and rendered state to agree after every interruption.
- Re-run complete WebKit suite after every behavior fix.

### Round C — Performance, device, and accessibility

- Record Safari Timelines for onboarding, Today ↔ Wardrobe ↔ Today, and reveal → targeted revision → Undo.
- Inspect frames, layout/rendering, JS/events, media/animations, long tasks, and teardown.
- Run the dev frame sampler relative to measured refresh interval.
- Review iOS Reduce Motion, safe areas, address-bar changes, Home Screen mode, touch feel, and sound/non-visual feedback.

## Recorded evidence — 2026-07-20

- Round A: the four named iPhone sizes and reduced-motion frames were regenerated from production components. Manual desktop review confirmed complete garments, stable hierarchy, the clean sneaker asset, and no hidden future text.
- Round B: the serial WebKit motion suite passed 7/7. The main Chromium/WebKit suite passed 23 with 5 engine-specific visual captures skipped. A regression discovered during the round (transparent garment canvas intercepting `Another`) was fixed and re-run in both engines.
- Round C automated portion: three clean frame-sampler runs reported median 17 ms, p95 23–24 ms, p99 24–25 ms, zero consecutive severe-frame runs, and 0–1 isolated severe frames. Reduced-motion visual/state checks passed.
- Production isolation: `/motion-review` returns 404, normal `/` and `/today` return 200, and deployable client chunks contain no GSDevTools, frame-sampler, timeline-control, Fine-tune review, or review-client strings.
- Device pending: physical iPhone Safari Timelines, dynamic address-bar and safe-area behavior, Home Screen mode, system edge arbitration, subjective spring/reading feel, iOS Reduce Motion, and audio/non-visual feedback.
