# YiYi Product Specification

This document is the current stable implementation contract. Its single-answer recommendation model supersedes the alternatives language in the original frozen master baseline.

## Product

YiYi is an iPhone-first, continuous voice outfit assistant. The user describes their day and desired feeling; YiYi chooses one outfit from the user’s real wardrobe and revises it naturally without changing unmentioned items.

The product reduces morning decision fatigue. It is not a digital-closet dashboard, a text chatbot, shopping product, social network, or virtual try-on system.

## Product behavior

- Product UI, examples, and voice output are English only.
- Microphone access is required for the core experience.
- A single tap starts a continuous live session. There is no record-and-send interaction.
- The user describes activities, comfort, feeling, weather needs, and constraints—not garment choices.
- YiYi is calm, warm, concise, decisive, non-judgmental, and usually speaks in one short sentence.
- The interface contains one current answer. Candidate diversity is internal and temporary; it is never exposed as a carousel or stored as second and third choices.
- Accessories are optional but are real wardrobe and recommendation inputs.
- Targeted revision changes only the target and freezes every other present or empty slot. Core structure changes are atomic. Global revision searches again against the validated new intent and still presents only one answer.
- Required, excluded, availability, weather, hard-avoid, and preserve rules have identical meaning in initial, targeted, global, random, and fallback operations.
- Only active canonical personalization signals are eligible to influence search or ranking. Calibration, explicit More/Less, and later repeated evidence remain distinct from temporary day constraints, review-only notes, and Demo data.
- Undo is deterministic and confirmation persists for the local calendar day.

## Cold-start style learning

YiYi asks what the user would actually wear through matched outfit pairs, not whether a single model photograph looks attractive. The normal path contains four base comparisons and, only when confidence remains low, at most two optional follow-ups. Every comparison offers **A**, **B**, **Both**, **Neither**, and **Skip**; the user may also finish early, and two consecutive Skips end calibration.

- A/B records the chosen look as positive relative evidence and keeps the unchosen look Unknown. It never invents a dislike.
- Both records broad positive evidence for both looks at lower differentiation confidence.
- Neither is the only comparison response that records two explicit, editable, soft negative onboarding signals.
- Skip records no style evidence and never increases confidence.
- Wardrobe direction describes the clothes the user expects to add. It is not gender identity and is not a hidden ranking feature.

The six versioned v2 boards use matching faceless mannequins, a neutral studio, stable framing, full outfits, and `object-fit: contain`. A session-stable seed alternates which canonical option appears left, the rendered halves are exchanged without mirroring the clothes, and each response records the actual presentation order. These controls reduce model, pose, crop, photography, and screen-position confounds; they do not prove that the synthetic set is bias-free.

After comparisons, Fine-tune offers explicit structured More of/Less of choices and optional voice input. YiYi shows the structured, editable meaning only after it is persisted; the raw transcript is not the result. Language that cannot be structured safely is retained as Needs review and does not affect recommendations. Profile review exposes More, Less, Still open, confidence, Back, Edit, and Undo.

## Competition experience

1. Splash
2. Teaching onboarding
3. Mandatory microphone gate
4. Descriptive wardrobe direction and matched-pair style calibration with A/B/Both/Neither/Skip
5. Structured Fine-tune More of/Less of and editable Style Profile review
6. Example wardrobe or personal wardrobe setup
7. Native camera/photo-library selection
8. Background removal and item analysis
9. Item review and taxonomy correction
10. Today continuous voice session
11. Editable intent tags
12. One current outfit answer
13. Voice/manual targeted, global, session-diverse random revision and exact undo through the real displayed-history stack
14. Confirmation and same-day recovery
15. Wardrobe, item details, visible preference memory, and settings

## P0 scope

P0 includes the complete mockable competition loop, local persistence, native picker, image processing adapters, deterministic recommendation/revision, GPT-5.6 ranking, OpenAI Realtime voice, fallbacks, tests, deployment readiness, and Build Week evidence. P1 and P2 items remain excluded until all P0 acceptance tests pass.

## Non-negotiable exclusions

No native app, authentication, cloud database, cross-device sync, calendar, notifications, community, shopping, virtual try-on, body analysis, dark mode, bilingual UI, full text chat, custom camera engine, or unfinished controls.

## Definition of done

A judge can open the URL on iPhone, grant microphone access, calibrate without forced answers or invented dislikes, inspect and correct the resulting profile, load the example wardrobe, describe a day, correct intent tags, receive one decisive answer, revise or replace it while preserving the correct history and unmentioned items, confirm it, refresh and recover it, and still receive a deterministic result if live ranking fails.
