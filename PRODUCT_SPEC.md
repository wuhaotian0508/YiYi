# YiYi Product Specification

This document is a stable implementation contract extracted from `YIYI_MASTER_DEVELOPMENT_SPEC.md`. The master specification remains authoritative when wording differs.

## Product

YiYi is an iPhone-first, continuous voice outfit assistant. The user describes their day and desired feeling; YiYi chooses one outfit from the user’s real wardrobe, offers two visually weaker alternatives, and revises the current outfit naturally without changing unmentioned items.

The product reduces morning decision fatigue. It is not a digital-closet dashboard, a text chatbot, shopping product, social network, or virtual try-on system.

## Product behavior

- Product UI, examples, and voice output are English only.
- Microphone access is required for the core experience.
- A single tap starts a continuous live session. There is no record-and-send interaction.
- The user describes activities, comfort, feeling, weather needs, and constraints—not garment choices.
- YiYi is calm, warm, concise, decisive, non-judgmental, and usually speaks in one short sentence.
- The result contains one decisive main recommendation and two weaker alternatives.
- Accessories are optional but are real wardrobe and recommendation inputs.
- Targeted revision changes only the target; global revision changes at most two core items plus accessories.
- Undo is deterministic and confirmation persists for the local calendar day.

## Competition experience

1. Splash
2. Teaching onboarding
3. Mandatory microphone gate
4. Visual style calibration and explicit avoids
5. Example wardrobe or personal wardrobe setup
6. Native camera/photo-library selection
7. Background removal and item analysis
8. Item review and taxonomy correction
9. Today continuous voice session
10. Editable intent tags
11. Main outfit and two alternatives
12. Voice/manual targeted revision and undo
13. Confirmation and same-day recovery
14. Wardrobe, item details, visible preference memory, and settings

## P0 scope

P0 includes the complete mockable competition loop, local persistence, native picker, image processing adapters, deterministic recommendation/revision, GPT-5.6 ranking, OpenAI Realtime voice, fallbacks, tests, deployment readiness, and Build Week evidence. P1 and P2 items remain excluded until all P0 acceptance tests pass.

## Non-negotiable exclusions

No native app, authentication, cloud database, cross-device sync, calendar, notifications, community, shopping, virtual try-on, body analysis, dark mode, bilingual UI, full text chat, custom camera engine, or unfinished controls.

## Definition of done

A judge can open the URL on iPhone, grant microphone access, load the example wardrobe, describe a day, correct intent tags, receive one main and two alternatives, make a targeted revision that preserves all other items, confirm the outfit, refresh and recover it, and still receive a deterministic result if live ranking fails.
