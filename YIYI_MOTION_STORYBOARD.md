# YiYi Motion Storyboard

This document is the implemented, executable timing and state contract for the authored onboarding. Times for the continuous scene are relative to the user's `Begin` activation. Named labels, causal order, interruption rules, and reduced-motion equivalents are verified by the serial WebKit motion suite.

## Splash

| Label | User sees | Trigger | Start–finish | Hold | Exit | Interruptible | Reduced motion | Engine |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `arrival` | Quiet white field, then “What should I wear today?” | First mount | 0.00–0.95 s | 0.30 s | Subtitle begins | No | Opacity only | GSAP |
| `arrival:promise` | “Tell YiYi in one sentence.” | Title settled | 1.25–2.35 s | 1.40 s | Begin becomes available | No | Opacity only | GSAP |
| `arrival:ready` | Begin action | Promise readable | 3.75–4.05 s | Indefinite | User taps Begin | Yes | Immediate opacity | GSAP |

Splash never advances automatically. The button appears only after the two lines have settled, then remains available indefinitely.

The interaction boundary is intentionally placed after the GSAP pause position. A regression test forces the playhead across that boundary and proves that `decision:start` cannot run until the user activates Begin.

## Continuous conversational scene

| Scene / label | User sees | Entry trigger | Text/state content | Start–finish | Hold | Exit | Skip / interrupt | Reduced-motion equivalent | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `decision:start` | One quiet speech/input field and an idle YiYi Core | Begin | Empty field; cursor appears | 0.00–0.45 s | 0.20 s | First phrase starts | Skip always available | Field and Core fade in | GSAP outer scene |
| `decision:hesitation-1` | User begins trying to assemble an outfit | Prior label | `Maybe my navy hoodie...` then `with blue jeans...` | 0.65–4.70 s | 0.55 s between clauses | Next thought | Yes | First two lines appear as a complete readable state | GSAP TextPlugin |
| `decision:hesitation-2` | The choice becomes less certain | Prior phrase | `No, maybe the black trousers...` then `or the grey jacket...` | 5.25–9.75 s | 0.70 s | Final hesitation | Yes | Full indecisive paragraph replaces prior state with opacity | GSAP TextPlugin |
| `decision:questions-complete` | `No... no...` and `what should I wear?????` | Prior phrase | Punctuation uses longer pauses; question marks accelerate slightly | 10.45–13.95 s | 0.25 s | Cursor hold | Yes | Full paragraph remains visible | GSAP TextPlugin |
| `decision:cursor-hold` | A short blinking caret after the final question mark | Text complete | No new content | 14.20–15.35 s | 1.15 s total | Delete begins | Yes | Static caret, no blink | GSAP/CSS caret |
| `decision:delete` | Every character disappears from the end; slow first, then faster | Cursor hold complete | Entire indecisive paragraph is removed in reverse order | 15.35–18.75 s | 0.45 s empty field | Reframe starts | Yes; Skip kills timeline and clears caret | Indecisive paragraph crossfades out as one state | GSAP TextPlugin |
| `reframe:start` | User expresses the day and desired feeling in the same location | Empty hold complete | `I have class, dinner with friends,\nand a lot of walking.` | 19.20–23.35 s | 0.45 s | Second sentence | Yes | First reframe sentence fades in complete | GSAP TextPlugin |
| `reframe:complete` | The expression becomes sufficient without choosing an outfit | First sentence | `I want to feel relaxed and still look put together.` | 23.80–27.75 s | 0.90 s | Core responds | Yes | Full reframe paragraph visible, opacity only | GSAP TextPlugin |
| `understanding` | Core shifts Listening → Understanding; semantic chips form only after their source phrase | Reframe complete | `Class`, `Dinner with friends`, `Lots of walking`, `Relaxed`, `Put together` | 28.65–31.75 s | 0.35 s between semantic groups | Outfit starts | Yes | State title and chips crossfade in semantic groups | GSAP groups + existing Core state |
| `outfit:assemble` | Stable editorial flat-lay forms around a fixed primary axis | Understanding settled | Outerwear/top/bottom/shoes/bag appear by dressing relationship, not uniform stagger | 32.10–35.20 s | 1.20 s | Reason appears then revision begins | Yes | Complete outfit fades in; no travel/scale | GSAP trigger + Motion item presence |
| `revision:request` | User request appears below the recommendation; Core becomes Revising | Outfit readable | `Make it a little more relaxed.` | 36.40–38.45 s | 0.65 s | Meaning morph begins | Yes | Request and Revising state crossfade in | GSAP TextPlugin + Core state |
| `revision:meaning` | `Put together` changes in place to `Relaxed` | Request complete | Source meaning is retained visually until target meaning is legible | 39.10–40.00 s | 0.35 s | Shoe replacement | Yes | Instant text replacement with opacity | GSAP outer group |
| `revision:replace` | Old shoe exits and new shoe enters at the identical slot; every other box is fixed | Meaning settled | Only `shoes` itemId changes | 40.35–41.55 s | 0.65 s | Reason updates | Yes; newest state wins | Crossfade only in shoe slot | Motion keyed presence |
| `complete` | Updated reason and “Everything else stayed.” | Replacement settled | Final causal explanation | 42.20–43.20 s | 1.80 s | Permission scene | Skip remains available until exit | Opacity only | GSAP outer scene |

## Text rhythm contract

- Letters inside an ordinary phrase are continuous; punctuation inserts authored holds.
- Comma: short thinking pause. Ellipsis: longer hesitation. Newline: visible breath. Consecutive question marks accelerate slightly after the first mark.
- Future characters are not pre-rendered in a visible layer.
- Typing and deletion write directly through TextPlugin; they never update React state per character.
- Deletion begins at the final character, preserves the same layout box, and accelerates without an abrupt clear.
- Skip kills/reverts the active timeline before navigating to permission. Restart starts from a clean deterministic scene.

## Runtime motion state contracts

| Surface | State sequence | Spatial/causal contract | Owner |
| --- | --- | --- | --- |
| Voice Dock | idle → connecting → listening → thinking → speaking / interrupted / error | Visuals render only the coordinator snapshot; replacement is immediate and mutually exclusive | Motion values + CSS color |
| Initial recommendation | generating → presenting | One answer, stable canvas bounds, reason follows completed reveal | Motion |
| Targeted revision | request → revising → committed version | Target slot only; unmentioned item geometry remains within test tolerance | Motion layout/presence |
| Random | committed version A → B | New persisted winner replaces prior reveal; later Undo cancels B reveal | Motion |
| Undo | current version → exact parent | Geometry follows restored item IDs; no speculative intermediate outfit | Motion |
| Confirm | current → confirmed | Outfit stays spatially anchored while actions/status resolve | Motion |
| Bottom sheet | closed ↔ dragging ↔ settling ↔ dismissed | Sheet owns vertical drag; background depth/opacity follows the same motion value | Motion |
| Today ↔ Wardrobe | slide 0 ↔ slide 1 | Swiper owns 1:1 track, intent lock, velocity, resistance, and settlement | Swiper |
| Calibration | question N → N+1; profile signal insert/delete | Image stays `contain`; selection and saved signal reflect real state only | Motion presence/layout |
| System states | loading / empty / permission / provider error | No infinite decorative motion; recovery action remains stable and reachable | Motion/CSS |
