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
- Personalization changes ranking through semantic calibration anchors, explicit More/Less signals, profile weights, confirmations, and confidence-aware item features; temporary day constraints do not silently become permanent preferences.
- Undo is deterministic and confirmation persists for the local calendar day.

## Competition experience

1. Splash
2. Teaching onboarding
3. Mandatory microphone gate
4. Wardrobe direction, flexible positive/negative/skip style calibration, and balanced More of/Less of preferences
5. Example wardrobe or personal wardrobe setup
6. Native camera/photo-library selection
7. Background removal and item analysis
8. Item review and taxonomy correction
9. Today continuous voice session
10. Editable intent tags
11. One current outfit answer
12. Voice/manual targeted, global, session-diverse random revision and exact undo through the real displayed-history stack
13. Confirmation and same-day recovery
14. Wardrobe, item details, visible preference memory, and settings

## P0 scope

P0 includes the complete mockable competition loop, local persistence, native picker, image processing adapters, deterministic recommendation/revision, GPT-5.6 ranking, OpenAI Realtime voice, fallbacks, tests, deployment readiness, and Build Week evidence. P1 and P2 items remain excluded until all P0 acceptance tests pass.

## Non-negotiable exclusions

No native app, authentication, cloud database, cross-device sync, calendar, notifications, community, shopping, virtual try-on, body analysis, dark mode, bilingual UI, full text chat, custom camera engine, or unfinished controls.

## Definition of done

A judge can open the URL on iPhone, grant microphone access, calibrate without forced answers, load the example wardrobe, describe a day, correct intent tags, receive one decisive answer, revise or replace it while preserving the correct history and unmentioned items, confirm it, refresh and recover it, and still receive a deterministic result if live ranking fails.
