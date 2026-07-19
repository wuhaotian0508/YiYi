# YiYi — Master Product & Engineering Specification

**Document status:** Frozen implementation baseline v1.0  
**Date:** 2026-07-16  
**Primary target:** iPhone, iOS 17+ Safari and Home Screen web app  
**Competition:** OpenAI Build Week 2026 — recommended track: **Apps for Your Life**  
**Implementation owner:** Codex  
**Product owner:** the repository owner  
**Visible product language:** English only  
**Discussion/specification language:** Chinese  
**Reference UI:** all images inside the local `参考图/` folder

---

> **Current product decision — 2026-07-17:** This file preserves the original frozen planning baseline. The repository owner subsequently superseded its exposed-alternatives and fixed-count calibration rules. The current implementation and the root contracts (`PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `API_CONTRACTS.md`, and `TEST_PLAN.md`) display exactly one current recommendation, keep candidate pools request-scoped, use real displayed-state history for Undo, and allow flexible like/dislike/skip calibration. Those decisions take precedence wherever this historical baseline differs.

---

## 0. How Codex must use this document

This is the main source of truth for the first competition build.

Priority order when sources disagree:

1. This specification.
2. The UI references in `参考图/`.
3. Shared Zod schemas and API contracts in the repository.
4. Existing implementation.
5. Ad-hoc assumptions.

Codex must not silently invent a different product, architecture, interaction model, data taxonomy, or navigation system. When a technical impossibility is found, stop, document the exact blocker and the smallest viable deviation before changing the contract.

### Clean-room requirement

This is a completely new independent project.

- Create a new repository and new commit history.
- Do not clone the old `clothes-choosing` repository into this workspace.
- Do not copy, rewrite, translate, imitate, or reuse its code, UI, documentation, prompts, schemas, tests, or assets.
- The old project may only be mentioned in the submission as prior domain experience.
- Use only newly created project assets, properly licensed third-party assets, or assets whose provenance is documented.
- Add `ASSET_ATTRIBUTION.md` before submission.

---

# 1. Product definition

## 1.1 One-sentence product

**YiYi is a continuous voice-first morning outfit assistant: the user describes their day and desired feeling, YiYi chooses one main outfit from their real wardrobe, and the user can revise it naturally by voice.**

## 1.2 Problem

The product does not primarily solve wardrobe cataloguing. It solves morning decision fatigue.

The target moment is when the user:

- has just woken up;
- is in a hurry;
- has low energy;
- owns enough clothes but does not want to compare them;
- can describe the day more easily than manually build an outfit.

The product should reduce the number of choices the user must make. It must not transform “choose clothes” into “compare three equal recommendations.”

## 1.3 Core product behavior

The user says something such as:

> “I’m going to a gallery this afternoon and dinner with friends tonight. I’ll take photos, but I don’t want to look overdressed. No dresses today.”

YiYi:

1. understands the day and shows a small number of editable intent tags;
2. combines the user’s wardrobe, weather, long-term preferences, availability and recent wear;
3. presents one clear main recommendation;
4. keeps two visually weaker alternatives;
5. stays in the live voice session;
6. makes local revisions such as:
   - “The bag feels too formal.”
   - “Change the shoes to something more comfortable.”
   - “The whole outfit feels too mature.”
   - “Use silver instead.”
7. confirms the final outfit.

## 1.4 Product personality

YiYi is:

- calm;
- warm;
- decisive;
- concise;
- visually led;
- non-judgmental.

YiYi must:

- speak in English;
- usually respond in one short sentence;
- avoid long fashion explanations unless asked;
- never criticize the user’s body;
- never introduce “slimming,” “hiding fat,” or body flaws unless the user explicitly raises them;
- never claim a change succeeded until the corresponding tool actually succeeds;
- ask at most one clarifying question, only when a reasonable outfit cannot be produced without it.

## 1.5 Competition scope

### P0 — required for the Build Week version

- iPhone-first responsive interface matching the UI references.
- Splash and teaching onboarding.
- Mandatory microphone permission gate.
- Style calibration and explicit avoid preferences.
- Example wardrobe.
- Native iPhone camera/photo-library selection.
- AI background removal.
- GPT-5.6 visual clothing analysis.
- Simple tag correction.
- Local wardrobe persistence.
- Current or demo weather context.
- Continuous Realtime voice session.
- Editable understanding tags.
- Deterministic candidate generation.
- GPT-5.6 visual ranking.
- One main recommendation and two weaker alternatives.
- Targeted voice revision preserving unmentioned items.
- Undo.
- Outfit confirmation and same-day recovery after refresh.
- Rule-based fallback if ranking fails.
- Mock mode for automated development and testing.
- Deployable Vercel demo.
- README and Build Week submission evidence.

### P1 — implement only after all P0 acceptance tests pass

- Minimal manual cutout brush editor.
- Polished batch-processing queue.
- Production rate limiting with Upstash.
- Add-to-Home-Screen education.
- More sophisticated preference-learning evidence UI.
- More refined accessibility audit.

### P2 — explicitly out of scope until after the competition

- Native SwiftUI app.
- Android.
- iPad-specific layout.
- Account creation.
- Cloud database or cross-device sync.
- Calendar integration.
- Notifications.
- Community or social sharing.
- Shopping recommendations.
- Virtual try-on.
- AI-generated model wearing the clothes.
- Body scanning.
- Full outfit history analytics.
- Chinese UI or bilingual voice mode.
- Dark mode.
- Complex offline AI.

No P2 feature may be added “because it is easy.” Extra scope is a defect during the competition build.

---

# 2. Complete user experience

All copy below is visible in English.

## 2.1 Splash

White screen.

First line fades in:

> **What should I wear today?**

Second line fades in shortly after:

> **Tell [YiYi icon] in one sentence.**

The icon is embedded inline in the sentence. No button, navigation or gradient. Total duration about 1–1.5 seconds.

First-time users continue to onboarding. Returning users continue to Today.

## 2.2 Teaching onboarding

### Screen A

> **Tell YiYi about your day — not your clothes.**

> **YiYi will choose from your wardrobe for you.**

Incorrect example:

> “Brown hoodie with blue jeans.”  
> **You’re still choosing**

Correct example:

> “Class, dinner with friends, lots of walking, and I want to feel relaxed.”  
> **Let YiYi decide**

CTA:

> **Show me how**

### Screen B

A deterministic simulated voice exchange shows:

> “I have class, then dinner with friends. I’ll be walking a lot, and I want something relaxed but still photo-ready.”

The UI extracts:

- Class
- Dinner with friends
- Lots of walking
- Relaxed
- Photo-ready

No live API is called in this teaching animation.

### Screen C

YiYi shows a simulated outfit:

> **I’d wear this one.**

> **Relaxed, comfortable, and still intentional.**

The user says:

> “Make it a little less formal.”

Only one or two relevant items change.

CTA:

> **Try it yourself**

## 2.3 Mandatory microphone gate

After onboarding, request microphone permission from a direct user gesture.

Copy:

> **YiYi is built around live voice. Microphone access is required to continue.**

CTA:

> **Allow Microphone**

If denied:

> **YiYi needs microphone access to understand your day and adjust your outfit naturally.**

Show:

- **Allow Microphone**
- **Open Settings**

Do not offer a full text-chat alternative. The user cannot continue core onboarding until microphone access is granted.

Implementation note: call `navigator.mediaDevices.getUserMedia({ audio: true })`, confirm success, then stop the temporary tracks. The real Realtime connection is opened later from a separate explicit tap on Today.

## 2.4 Style calibration

### Likes

> **Which looks feel most like you?**

> **Choose three. Don’t overthink it.**

Show six visually diverse outfit references. User selects exactly three.

### Least like

> **Which one feels least like you?**

Select exactly one.

### Explicit avoids

> **Anything YiYi should usually avoid?**

Preset chips:

- Heels
- Tight fits
- Cropped tops
- Short skirts
- Bright colors
- Formal looks
- Gold-tone jewelry
- Silver-tone jewelry

Voice option:

> **Tell YiYi something else**

Generated summary:

> **Your style so far**

Example:

> Relaxed, clean, slightly cool-toned  
> Comfort over formality  
> Avoids heels and overly mature looks

CTA:

> **Looks right**

This is a deterministic local calculation from pre-annotated style images. Do not spend an AI request analyzing these fixed onboarding images.

## 2.5 Wardrobe setup branch

After style calibration, offer:

- **Try the example wardrobe**
- **Add my clothes**

The example wardrobe must allow a judge to experience the product immediately.

The personal wardrobe path explains:

> **Add a few tops, bottoms, shoes, and anything you often accessorize with.**

Do not require dozens of items. The app may warn about missing categories, but should allow the user to proceed when a structurally valid outfit can be built.

## 2.6 Add clothing

Use the native iOS camera or photo-library picker for reliability.

Entry actions:

- **Take Photos**
- **Choose from Library**

Photo guidance:

> **One item at a time**

> **A clear background works best.**

Although the UI reference visually resembles a custom camera, the competition implementation should launch the native iOS capture flow using a file input. Do not build a custom `getUserMedia` camera unless all P0 work is already complete.

Support multi-select from the library. Internally process with a queue, maximum concurrency 2.

## 2.7 AI processing

For each item:

1. client validation and preprocessing;
2. Photoroom background removal;
3. normalized transparent WebP generation;
4. GPT-5.6 Terra analysis;
5. local review;
6. save to IndexedDB.

UI states:

> **Removing background…**

> **Understanding the item…**

On success:

> **Ready to add**

Primary action:

> **Review details**

Secondary action:

> **Refine cutout**

The `Refine cutout` button must be hidden behind a feature flag until the P1 editor works. Never ship a dead button.

## 2.8 Item review

Do not ask the user to confirm or type a clothing name.

Show the cutout and four compact rows:

- Category
- Color
- Material
- More details

Example:

- Category — Hoodie
- Color — Brown
- Material — Cotton blend
- More details — 6 AI tags

Low-confidence fields show:

> **Please check**

Primary action:

> **Add to wardrobe**

### Color picker

Bottom sheet:

> **Select colors**

Fixed color taxonomy:

- Black
- White
- Gray
- Beige
- Brown
- Navy
- Blue
- Green
- Red
- Pink
- Purple
- Yellow
- Orange
- Metallic
- Multicolor

Select one primary and up to two secondary colors. Every swatch has a visible text label and accessible name.

### Material picker

> **Select materials**

- Suggested section
- Search
- Common materials
- Create custom material

Common materials:

- Cotton
- Denim
- Knit
- Wool
- Linen
- Leather
- Suede
- Silk
- Satin
- Polyester
- Nylon
- Fleece

### Category picker

Primary categories:

- Tops
- Bottoms
- Dresses & Jumpsuits
- Outerwear
- Shoes
- Accessories

Internal exact categories are defined later in this document. Accessories include:

- Bags
- Jewelry
- Hats
- Scarves
- Belts
- Eyewear
- Hair Accessories
- Other Accessories

## 2.9 Today idle

Top row:

- wardrobe icon;
- concise weather;
- preference/settings icon.

Center:

- YiYi visual core;
- **Tell YiYi about your day.**

A low-emphasis example:

> “Class in the morning, dinner tonight, and lots of walking.”

A single tap on the YiYi core begins a continuous session. It is not a “record and send” button.

## 2.10 Continuous voice session

During listening:

- the YiYi core breathes;
- status says **Listening…**;
- the latest transcript appears in no more than 2–3 lines;
- old transcript fades;
- controls are only Mute and End session.

No chat history. No message bubbles. No large send button.

After the user’s turn, the screen displays editable intent tags such as:

- Gallery
- Dinner with friends
- Photo-ready
- Not overdressed
- No dresses

These tags are generated from the structured `DailyIntent`, not from a second summary model call.

If a tag is wrong, tapping it opens a contextual bottom sheet. Updating a tag edits `DailyIntent` directly and re-runs recommendation logic.

## 2.11 Outfit result

The result screen remains inside the live voice session.

Center one main outfit:

> **I’d wear this one today.**

Reason:

> **Cool and effortless, but still works well for photos.**

Two weaker alternatives are partly visible left and right. They are not equal cards and are not labeled “Option 1 / 2 / 3.” Optional labels may say:

- More relaxed
- More polished

The outfit canvas can include:

- top;
- bottom or one-piece;
- outerwear;
- shoes;
- 0–1 bag;
- 0–1 jewelry item;
- 0–1 additional accessory.

Accessories are optional, not forced.

## 2.12 Revision

Targeted request:

> “The bag feels too formal.”

Only the bag changes. All unmentioned item IDs remain exactly the same.

Response:

> **Better. I kept everything else.**

Targeted examples:

- Change the shoes to something more comfortable.
- Add a bag.
- No jewelry today.
- Use silver instead.
- This jacket is in the laundry.
- Go back.

Global style request:

> “The whole outfit feels too mature.”

The system may change at most two core items plus accessories and should preserve at least half of the current core outfit when possible.

Manual backup interactions:

- tap an intent tag to correct it;
- tap an item to identify it;
- swipe to an alternative;
- tap Replace;
- tap Undo;
- tap Wear this today.

Manual interaction is for correction and accessibility, not a replacement text-chat product.

## 2.13 Confirmation

Voice:

> “I’ll wear this.”

or CTA:

> **Wear this today**

Confirmation state:

> **Outfit decided.**

> **One less thing to think about.**

Save the session, final outfit and worn timestamps. Close the Realtime session. Reopening the app on the same day shows the confirmed outfit with an option to revise.

## 2.14 Wardrobe and memory

Wardrobe:

- transparent item grid;
- category filter;
- search;
- add item;
- availability badge such as **In laundry**.

Item detail:

- Category
- Color
- Material
- Fit
- Warmth
- Formality
- Style
- Availability
- Edit details
- Mark as unavailable
- Refine cutout
- Delete item

Memory:

> **What YiYi remembers**

Sections:

- Your style
- Usually avoid
- Comfort
- Jewelry preference

Every memory can be edited or deleted. Never hide learned preferences from the user.

---

# 3. UI implementation rules

## 3.1 Reference images

At startup, Codex must inspect every image in the local `参考图/` folder.

Use them to infer:

- hierarchy;
- spacing;
- component composition;
- outfit positioning;
- bottom-sheet behavior;
- icon weight;
- animation intent.

Do not:

- embed the reference boards in the app;
- crop them into production assets;
- treat every pixel as a fixed absolute coordinate;
- add visual styles not present in the references;
- recreate a desktop dashboard.

## 3.2 Design tokens

Create CSS variables in one central file.

Recommended baseline:

```css
--color-black: #111111;
--color-dark-gray: #333333;
--color-medium-gray: #8e8e93;
--color-light-gray: #f2f2f7;
--color-white: #ffffff;
--color-success: #2f8f57;
--color-error: #d92d20;

--space-page: 20px;
--space-section: 24px;
--touch-target: 44px;
--button-height: 50px;
--radius-chip: 999px;
--radius-card: 18px;
--radius-sheet: 26px;
--radius-button: 999px;
```

The colors of real clothes provide most of the page’s color. Do not add blue-purple “AI” gradients.

## 3.3 Typography

Use the system font stack:

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "SF Pro Text",
  "SF Pro Display",
  "Helvetica Neue",
  Arial,
  sans-serif;
```

Do not download or bundle Apple font files.

Use semantic text tokens rather than one-off pixel values. Approximate reference hierarchy:

- splash/title: 32–34px semibold;
- page title: 24–28px semibold;
- body: 16–17px;
- secondary: 14–15px;
- caption: 12–13px.

## 3.4 iPhone layout

Target iOS 17+.

Baseline design width: 390px. Test at:

- 375 × 667;
- 390 × 844;
- 393 × 852;
- 430 × 932.

Use:

- `min-height: 100dvh`;
- `viewport-fit=cover`;
- `env(safe-area-inset-top)`;
- `env(safe-area-inset-bottom)`;
- no content under the Dynamic Island or Home Indicator;
- no fixed pixel height assumption.

Minimum interactive target: 44 × 44px.

No global bottom navigation.

## 3.5 Motion

Use the `motion` package for meaningful transitions and CSS for simple fades.

Recommended behavior:

- standard transition: 180–260ms;
- outfit replacement: old item fade/scale out, new item fade/scale in;
- listening pulse: about 1.6–2.0s;
- bottom sheet spring should be subtle, not playful;
- no confetti except a very restrained confirmation accent if it matches the reference;
- support `prefers-reduced-motion`.

## 3.6 Components

Build reusable primitives:

- `YiYiMark`
- `YiYiVoiceCore`
- `PageHeader`
- `PrimaryButton`
- `SecondaryButton`
- `IntentChip`
- `AttributeRow`
- `TaxonomyPicker`
- `BottomSheet`
- `WardrobeItemTile`
- `OutfitCanvas`
- `OutfitCarousel`
- `ProcessingQueue`
- `EmptyState`
- `InlineStatus`
- `PermissionGate`

All visible strings live in `src/content/copy.ts`.

---

# 4. Frozen technical architecture

## 4.1 Platform

Build an iPhone-first mobile web app / Home Screen web app.

Do not build native SwiftUI for the competition.

The deployed URL must work directly in Safari; installation to Home Screen is optional. Add:

- Web App Manifest;
- `display: standalone`;
- app name and short name;
- `apple-touch-icon`;
- theme/background color white;
- appropriate Apple mobile-web-app meta tags.

A service worker is not required for P0. Do not spend time on complex offline support.

## 4.2 Stack

- Next.js App Router
- React
- TypeScript in strict mode
- Tailwind CSS
- Motion for React (`motion`)
- Zustand for ephemeral UI/session state
- Dexie + IndexedDB for persistence
- Zod v4 as the canonical schema layer
- OpenAI official JavaScript SDK
- OpenAI Agents SDK `@openai/agents/realtime`
- Photoroom Remove Background API
- Sharp in Node route for cutout normalization
- Open-Meteo
- Vitest + React Testing Library
- Playwright
- pnpm
- Vercel Node.js runtime

Do not use:

- Express;
- Supabase;
- Firebase;
- Prisma;
- a cloud database;
- a separate backend repository;
- XState;
- shadcn;
- a large UI kit;
- a custom native camera;
- a raw hand-written WebRTC SDP implementation;
- generated virtual try-on images.

## 4.3 Important verified correction: Realtime implementation

Use the official OpenAI Agents SDK:

```ts
import {
  RealtimeAgent,
  RealtimeSession,
  tool,
} from "@openai/agents/realtime";
```

The browser obtains a short-lived ephemeral client secret from the project backend, then calls:

```ts
await session.connect({ apiKey: ephemeralSecret });
```

The SDK automatically uses WebRTC in the browser and manages microphone capture, output audio, interruptions, local history and tool execution.

Do not manually implement `RTCPeerConnection`, SDP offers or `/v1/realtime/calls` unless the SDK cannot satisfy a documented requirement. Manual WebRTC would create unnecessary code and debugging risk.

Backend token route calls:

```text
POST https://api.openai.com/v1/realtime/client_secrets
```

with the long-lived server API key and:

```json
{
  "session": {
    "type": "realtime",
    "model": "gpt-realtime-2.1"
  }
}
```

Return only the top-level ephemeral `value` to the browser. Never expose `OPENAI_API_KEY`.

## 4.4 Models

Production:

- Item analysis: `gpt-5.6-terra`
- Visual candidate ranking: `gpt-5.6` alias / GPT-5.6 Sol
- Voice: `gpt-realtime-2.1`

Development voice:

- `gpt-realtime-2.1-mini`

Settings:

- item analysis reasoning: `none`;
- ranking reasoning: `low`;
- Realtime reasoning: use the installed SDK’s typed configuration and keep it low if supported;
- Responses requests: `store: false`;
- use Structured Outputs for Terra and Sol;
- Realtime does not support Structured Outputs, so all tool parameters must be Zod-strict.

## 4.5 Architectural boundaries

### Realtime model owns

- dialogue turn-taking;
- recognizing whether the user is requesting, revising, confirming or updating availability;
- converting natural language into strict tool parameters;
- short spoken responses.

### Deterministic domain code owns

- hard constraints;
- item availability;
- taxonomy;
- outfit structural validity;
- weather safety;
- candidate generation;
- preserving unmentioned items;
- version history;
- undo;
- persistence;
- stale request prevention.

### GPT-5.6 Terra owns

- visual analysis of one cutout item;
- structured tags and confidence.

### GPT-5.6 Sol owns

- visual comparison of already legal outfit candidates;
- ranking one main and two alternatives;
- short reasons.

Sol must never invent wardrobe items. It only returns candidate IDs.

---

# 5. Repository structure

Use `src/`:

```text
yiyi/
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── onboarding/page.tsx
│   │   ├── today/page.tsx
│   │   ├── wardrobe/page.tsx
│   │   ├── wardrobe/add/page.tsx
│   │   ├── wardrobe/[itemId]/page.tsx
│   │   ├── preferences/page.tsx
│   │   ├── settings/page.tsx
│   │   └── api/
│   │       ├── realtime/token/route.ts
│   │       ├── wardrobe/process/route.ts
│   │       ├── outfits/rank/route.ts
│   │       ├── weather/route.ts
│   │       └── health/route.ts
│   ├── components/
│   │   ├── brand/
│   │   ├── onboarding/
│   │   ├── voice/
│   │   ├── wardrobe/
│   │   ├── outfit/
│   │   ├── preferences/
│   │   └── ui/
│   ├── content/
│   │   └── copy.ts
│   ├── domain/
│   │   ├── schemas/
│   │   ├── taxonomy/
│   │   ├── preferences/
│   │   ├── recommendation/
│   │   ├── revision/
│   │   └── session/
│   ├── lib/
│   │   ├── ai/
│   │   ├── realtime/
│   │   ├── images/
│   │   ├── storage/
│   │   ├── weather/
│   │   └── errors/
│   ├── prompts/
│   │   ├── item-analysis.ts
│   │   ├── outfit-ranking.ts
│   │   └── realtime-agent.ts
│   └── mocks/
├── public/
│   ├── demo-wardrobe/
│   ├── style-calibration/
│   └── brand/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── 参考图/
├── AGENTS.md
├── PRODUCT_SPEC.md
├── ARCHITECTURE.md
├── DATA_MODEL.md
├── API_CONTRACTS.md
├── TEST_PLAN.md
├── ASSET_ATTRIBUTION.md
├── .env.example
└── README.md
```

This master document may initially serve as the source for the six smaller repository documents. Codex should split it without changing decisions.

---

# 6. Canonical schemas and taxonomy

Zod schemas are the source of truth. Infer TypeScript types with `z.infer`. Do not manually duplicate interfaces.

## 6.1 Categories

Exact internal values:

```ts
const ClothingCategorySchema = z.enum([
  "top",
  "bottom",
  "one_piece",
  "outerwear",
  "shoes",
  "bag",
  "jewelry",
  "headwear",
  "scarf",
  "belt",
  "eyewear",
  "hair_accessory",
  "other_accessory",
]);
```

The UI groups accessory categories under “Accessories,” but the stored values remain specific.

## 6.2 Colors

```ts
const ColorIdSchema = z.enum([
  "black",
  "white",
  "gray",
  "beige",
  "brown",
  "navy",
  "blue",
  "green",
  "red",
  "pink",
  "purple",
  "yellow",
  "orange",
  "metallic",
  "multicolor",
]);
```

## 6.3 Controlled properties

Use controlled enums where possible:

```ts
Pattern:
solid, striped, checked, floral, graphic, textured, animal, other, unknown

Fit:
slim, regular, relaxed, oversized, cropped, longline, other, unknown

Availability:
available, laundry, unavailable

Metal:
gold, silver, mixed, none, unknown
```

Materials, style tags and occasion tags can include custom strings but must be normalized:

- trim;
- lowercase internal form;
- 40-character maximum;
- deduplicate case-insensitively;
- no more than 12 tags per list.

## 6.4 Wardrobe item

Metadata table:

```ts
const WardrobeItemSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(1),

  category: ClothingCategorySchema,
  subtype: z.string().min(1).max(40),

  primaryColor: ColorIdSchema,
  secondaryColors: z.array(ColorIdSchema).max(2),

  materials: z.array(z.string().min(1).max(40)).max(4),
  pattern: PatternSchema,
  fit: FitSchema,

  warmth: z.number().int().min(1).max(5),
  formality: z.number().int().min(1).max(5),
  comfort: z.number().int().min(1).max(5),

  styleTags: z.array(z.string()).max(12),
  occasionTags: z.array(z.string()).max(12),
  weatherTags: z.array(z.string()).max(12),

  metal: MetalSchema.optional(),

  availability: AvailabilitySchema,
  unavailableReason: z.string().max(120).optional(),

  aiConfidence: z.object({
    category: z.number().min(0).max(1),
    colors: z.number().min(0).max(1),
    materials: z.number().min(0).max(1),
    pattern: z.number().min(0).max(1),
  }),

  internalDescription: z.string().max(240),
  userEditedFields: z.array(z.string()).default([]),

  createdAt: z.number(),
  updatedAt: z.number(),
  lastWornAt: z.number().nullable(),
});
```

No visible clothing-name field is required. `subtype` and `internalDescription` support accessibility, search and model context.

## 6.5 Image table

Keep blobs separate from metadata so wardrobe queries do not load large images.

```ts
const ItemImageSetSchema = z.object({
  itemId: z.string().uuid(),
  originalBlob: z.instanceof(Blob).optional(),
  cutoutBlob: z.instanceof(Blob),
  thumbnailBlob: z.instanceof(Blob),
  cutoutMaskBlob: z.instanceof(Blob).optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
```

## 6.6 Style profile

Fixed style vector dimensions:

```ts
const StyleVectorSchema = z.object({
  relaxedPolished: z.number().min(-1).max(1),
  minimalExpressive: z.number().min(-1).max(1),
  softCool: z.number().min(-1).max(1),
  fittedOversized: z.number().min(-1).max(1),
  classicTrendAware: z.number().min(-1).max(1),
  feminineNeutral: z.number().min(-1).max(1),
});
```

Preference profile:

```ts
const PreferenceProfileSchema = z.object({
  id: z.literal("default"),
  styleVector: StyleVectorSchema,
  hardAvoids: z.array(PreferenceRuleSchema),
  softPreferences: z.array(PreferenceRuleSchema),
  preferredMetals: z.array(z.enum(["gold", "silver", "mixed"])),
  comfortWeight: z.number().min(0).max(1),
  formalityBias: z.number().min(-1).max(1),
  evidence: z.array(PreferenceEvidenceSchema).max(100),
  updatedAt: z.number(),
});
```

Only explicit “always / never / usually / generally” statements or repeated evidence may become long-term memory.

## 6.7 Daily intent

```ts
const DailyIntentSchema = z.object({
  activities: z.array(z.object({
    label: z.string().min(1).max(60),
    timeOfDay: z.enum(["morning", "afternoon", "evening", "all_day", "unknown"]),
  })).max(8),

  aestheticTerms: z.array(z.string().min(1).max(50)).max(10),

  desiredFormality: z.number().int().min(1).max(5).optional(),
  comfortPriority: z.number().int().min(1).max(5).default(3),
  photoPriority: z.number().int().min(1).max(5).default(3),
  walkingIntensity: z.number().int().min(1).max(5).default(2),

  excludedCategories: z.array(ClothingCategorySchema),
  excludedItemIds: z.array(z.string().uuid()),
  requiredItemIds: z.array(z.string().uuid()),

  temporaryPreferences: z.array(PreferenceRuleSchema),
  freeformSummary: z.string().max(300),
});
```

## 6.8 Outfit and versions

```ts
const OutfitSchema = z.object({
  id: z.string().uuid(),
  itemIds: z.object({
    top: z.string().uuid().optional(),
    bottom: z.string().uuid().optional(),
    onePiece: z.string().uuid().optional(),
    outerwear: z.string().uuid().optional(),
    shoes: z.string().uuid(),
    bag: z.string().uuid().optional(),
    jewelry: z.string().uuid().optional(),
    extraAccessory: z.string().uuid().optional(),
  }),
  deterministicScore: z.number(),
  reason: z.string().max(160).optional(),
});
```

Version:

```ts
const OutfitVersionSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  parentVersionId: z.string().uuid().nullable(),
  outfit: OutfitSchema,
  revisionRequest: z.string().max(300).nullable(),
  changedItemIds: z.array(z.string().uuid()),
  preservedItemIds: z.array(z.string().uuid()),
  createdAt: z.number(),
});
```

## 6.9 Daily session

Store date with local time-zone date key, for example `2026-07-16`.

A daily session includes:

- id;
- dateKey;
- status: draft / active / confirmed;
- DailyIntent;
- weather snapshot;
- current version ID;
- main recommendation ID;
- alternative IDs;
- created and updated timestamps;
- confirmed timestamp.

---

# 7. Persistence and state

## 7.1 Dexie tables

Use separate tables:

- `wardrobeItems`
- `itemImages`
- `preferenceProfiles`
- `dailySessions`
- `outfitVersions`
- `appSettings`
- `processingJobs`

Suggested indexes:

```text
wardrobeItems:
&id, category, availability, lastWornAt, createdAt

itemImages:
&itemId

dailySessions:
&id, dateKey, status

outfitVersions:
&id, sessionId, parentVersionId, createdAt

processingJobs:
&id, status, createdAt
```

Create explicit Dexie version 1 and a migration pattern even if only v1 exists.

## 7.2 Storage policy

After onboarding, on a user gesture:

```ts
await navigator.storage.persist();
```

Also use:

```ts
await navigator.storage.estimate();
```

Do not block the user if persistence is not granted. Log the result and show a storage warning only when app usage exceeds an internal threshold.

Application target:

- keep processed images compact;
- warn near 150MB;
- hard-stop additional uploads around 200MB until items are deleted;
- never store Data URLs in IndexedDB;
- revoke temporary Object URLs after use.

A Home Screen web app and the Safari website may have separate storage contexts. Do not promise that adding to Home Screen transfers existing wardrobe data. For the competition, judges should use one context consistently.

## 7.3 Zustand

Zustand stores only ephemeral UI/session state:

- current route-level phase;
- current DailyIntent draft;
- Realtime connection state;
- active request IDs;
- selected item;
- active bottom sheet;
- current recommendation presentation.

Dexie remains the source of persisted truth. Do not duplicate the full wardrobe in Zustand.

## 7.4 Session phase

```ts
type SessionPhase =
  | "idle"
  | "permission_required"
  | "connecting"
  | "listening"
  | "understanding"
  | "generating"
  | "presenting"
  | "revising"
  | "confirmed"
  | "error";
```

All async operations carry a request ID. A stale response cannot overwrite newer state.

Use `AbortController` for cancellable rank/weather requests.

---

# 8. Image capture and processing

## 8.1 Native capture decision

Use:

```html
<input
  type="file"
  accept="image/*"
  capture="environment"
/>
```

and a separate multi-select library input.

This launches the native iPhone camera or picker. It is more reliable than building a custom camera and avoids permissions, orientation, focus and memory bugs.

The branded capture page in the reference is the visual entry state, not a requirement to reproduce the camera engine.

## 8.2 Client preprocessing

Accepted input:

- JPEG
- PNG
- WebP
- HEIC / HEIF

Limits:

- reject files above 20MB before processing;
- target request below 4.1MB to leave multipart overhead below Vercel’s 4.5MB function limit;
- target longest side 1800–2000px;
- JPEG/WebP quality about 0.82.

Pipeline:

1. inspect MIME/type;
2. try native `createImageBitmap` with orientation correction;
3. if HEIC/HEIF cannot decode, dynamically import a HEIC conversion adapter;
4. convert to JPEG or WebP;
5. resize;
6. verify final byte size;
7. enqueue upload.

Keep HEIC conversion behind `ImagePreprocessor` so the library can be replaced without touching product code.

Process queue concurrency: 2.

## 8.3 Server route

`POST /api/wardrobe/process`

- Node.js runtime, not Edge.
- `multipart/form-data`.
- maximum one image per request.
- validate MIME and actual magic bytes.
- reject over limit.
- do not log image bytes or base64.

### Photoroom request

Endpoint:

```text
POST https://sdk.photoroom.com/v1/segment
```

Headers:

```text
x-api-key: PHOTOROOM_API_KEY
```

Parameters:

```text
format=webp
channels=rgba
size=medium
crop=true
```

Rationale:

- WebP preserves alpha with smaller files.
- `medium` is 1.5MP and sufficient for an iPhone outfit canvas.
- `crop=true` removes inconsistent transparent borders.
- the app then normalizes every item to its own standard transparent canvas.

### Normalize with Sharp

After Photoroom:

1. read transparent WebP;
2. trim any residual transparent border;
3. place the item inside a 1024×1024 transparent canvas;
4. preserve aspect ratio;
5. add about 8% visual padding;
6. export transparent WebP around quality 88–92;
7. enforce an output byte ceiling;
8. create analysis input from this normalized cutout.

Return only one normalized 1024 image plus structured analysis. The client creates a 320px thumbnail using canvas and stores both blobs.

If the JSON base64 response would exceed a safe threshold, lower WebP quality/size before returning. Request and response must remain below Vercel limits.

## 8.4 GPT-5.6 Terra analysis

Use the official Responses API and Structured Outputs with Zod.

Request content:

- one normalized cutout image;
- a short task instruction;
- exact controlled taxonomy;
- no original background image unless analysis fails.

Model:

```text
gpt-5.6-terra
```

Rules:

- visible evidence only;
- do not guess brand;
- use `unknown` when material is uncertain;
- do not infer occasion from a person/background;
- select fixed colors;
- return confidence honestly;
- classify accessories specifically;
- no long prose.

Set `store: false`.

Low-confidence threshold for UI warning: below 0.65.

## 8.5 Failure behavior

Photoroom failure:

- retry once for timeout/5xx;
- no retry for validation/credit/4xx;
- show processing failure;
- allow Try again or Remove from list;
- do not accept a background image as successful.

Terra failure:

- preserve the cutout;
- open minimal manual flow requiring Category and Color;
- allow Material to remain unknown.

## 8.6 Cutout editor

P1 only.

Minimal editor:

- original image behind mask;
- Erase and Restore brushes;
- brush size;
- undo stack maximum 10;
- save to transparent WebP;
- regenerate thumbnail.

Do not build automatic edge tools, lasso, feather controls or a full photo editor.

---

# 9. Realtime voice architecture

## 9.1 Adapter

Create:

```ts
interface VoiceSessionAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  mute(muted: boolean): void;
  onState(listener: (state: VoiceState) => void): () => void;
  onTranscript(listener: (transcript: TranscriptState) => void): () => void;
}
```

Implement:

- `OpenAIRealtimeVoiceAdapter`
- `MockVoiceSessionAdapter`

React components never talk directly to SDK transport details.

## 9.2 Ephemeral token route

`POST /api/realtime/token`

Backend:

1. validates same-origin request;
2. calls `/v1/realtime/client_secrets`;
3. sends typed session config;
4. returns `{ value, expiresAt? }`;
5. never caches;
6. never logs the token.

Token is minted only when the user explicitly starts a session.

## 9.3 Realtime agent

Use `RealtimeAgent` and `RealtimeSession`.

Production model: `gpt-realtime-2.1`.  
Development model: `gpt-realtime-2.1-mini`.

Initial voice: configure through `OPENAI_REALTIME_VOICE`; use `marin` only if supported by the installed API version.

Use typed SDK session configuration. Configure semantic VAD with medium eagerness and interruption when the installed SDK types support it. Do not bypass TypeScript with `as any` to force an outdated config shape.

The adapter maps SDK typed events into:

- idle;
- connecting;
- listening;
- thinking;
- speaking;
- interrupted;
- error.

Use the SDK’s local history for final user transcripts. For partial transcript deltas, use only documented typed transport events from the installed version. Do not parse arbitrary untyped event strings across the UI.

## 9.4 Agent instructions

Version the prompt in `src/prompts/realtime-agent.ts`.

Core prompt:

```text
You are YiYi, a calm and decisive voice-first outfit assistant.

Help the user decide what to wear by understanding their day, desired
feeling, comfort needs, activities, weather-related needs, and explicit
constraints.

The user should describe their day, not choose individual clothes.
Do not invent wardrobe items.
Do not claim that an outfit or item changed until a tool returns success.
Use the application tools for every recommendation, revision, confirmation,
availability change, or saved long-term preference.

Keep spoken replies under 20 words whenever possible.
Ask at most one clarification question, only when no reasonable outfit can
be produced without it.
Treat "today" constraints as session-only.
Only save a long-term preference when the user clearly says always, never,
usually, generally, or explicitly asks you to remember it.
```

Add concise few-shot examples for:

- initial request;
- targeted shoe revision;
- “too mature” global revision;
- laundry/unavailable;
- explicit long-term preference;
- undo;
- confirmation.

## 9.5 Tools

Use Zod-strict function tools.

### `request_outfit_recommendation`

Input: complete `DailyIntent`.

Execution:

1. update local DailyIntent;
2. load wardrobe/preferences/weather;
3. generate legal candidates;
4. rank;
5. save initial versions;
6. update UI;
7. return a short success summary to the agent.

### `revise_current_outfit`

Input:

- target category or `overall`;
- natural-language revision;
- preserveUnmentionedItems default true;
- optional referenced item ID.

Execution uses deterministic revision logic and ranking only where needed.

### `confirm_current_outfit`

Input: optional short confirmation note.

Execution saves final version and worn timestamps, then returns success.

### `set_item_availability`

Input:

- item ID or currently focused item reference;
- availability;
- optional reason.

Execution updates Dexie and re-runs recommendation if the active outfit becomes invalid.

### `save_explicit_preference`

Input:

- preference rule;
- polarity;
- evidence phrase.

Only use for clearly explicit/repeated long-term preferences.

Tool results must be small, serializable objects. Tool exceptions are transformed into short model-visible failure messages. Apply per-tool timeouts.

## 9.6 Session lifetime

- maximum active voice session: 5 minutes;
- disconnect after 90 seconds of inactivity;
- disconnect when page stays backgrounded;
- disconnect immediately after outfit confirmation;
- clean up microphone tracks and listeners on route change/unmount;
- do not keep a connection alive all day.

---

# 10. Weather

The competition P0 flow calls `GET /api/weather` without coordinates and uses fixed demo weather. It does not request device location permission.

The route can use Open-Meteo when both latitude and longitude are supplied explicitly by a future caller.

Input:

- latitude/longitude; or
- manually selected city.

Normalize to:

```ts
type WeatherContext = {
  minApparentTempC: number;
  maxApparentTempC: number;
  precipitationProbability: number;
  expectedRain: boolean;
  windy: boolean;
  summary: string;
  sourceTimestamp: number;
};
```

Use the next 12 hours, not only current conditions.

Cache for 15 minutes.

Weather failure does not block recommendation:

1. use recent cache;
2. otherwise omit weather;
3. YiYi may ask for an approximate temperature only if needed.

Demo mode may use a fixed weather fixture for reproducible recording.

---

# 11. Recommendation engine

## 11.1 Principle

Never send the whole wardrobe to GPT and ask it to freely invent an outfit.

Pipeline:

```text
DailyIntent
→ merge preferences/weather/availability/recency
→ hard filtering
→ category shortlist
→ legal outfit templates
→ deterministic scoring
→ diversity selection
→ render candidate boards
→ GPT-5.6 Sol ranking
→ main + two alternatives
```

## 11.2 Hard constraints

Code, not GPT, enforces:

- available items only;
- explicit excluded category;
- explicit excluded item;
- required item;
- structurally complete outfit;
- shoes required;
- severe weather mismatch;
- strong rain incompatibility;
- explicit no-heels/no-dress rules;
- walking requirement and clearly unsuitable shoes;
- targeted revision preservation.

## 11.3 Templates

Legal core templates:

```text
top + bottom + shoes
one_piece + shoes
top + bottom + outerwear + shoes
one_piece + outerwear + shoes
```

Add optional:

- 0–1 bag;
- 0–1 jewelry;
- 0–1 headwear/scarf/belt/eyewear/hair accessory.

Outerwear is optional or required according to weather/intent.

## 11.4 Category shortlists

Before combination, retain approximately:

- tops: 8
- bottoms: 8
- one-pieces: 8
- outerwear: 6
- shoes: 6
- bags: 5
- jewelry/accessories: 6

These are maxima, not requirements.

## 11.5 Deterministic score

Use normalized components:

- weather suitability;
- activity/occasion suitability;
- style-vector similarity;
- target formality;
- comfort priority;
- photo priority;
- walking suitability;
- color compatibility;
- explicit preference match;
- recent-wear penalty.

Keep scoring weights in one configuration object with unit tests.

Do not present scores to users.

## 11.6 Color compatibility

Implement a small explicit compatibility table, not a “perfect fashion” claim.

It should:

- reward neutral combinations;
- avoid obvious clashes when the user requests minimal/clean;
- allow expressive contrasts when the style vector supports it;
- treat metallics/accessory colors separately;
- never hard-ban a color combination unless explicitly excluded.

## 11.7 Diversity

Generate many legal candidates, then keep 8 maximum for visual ranking.

Diversity rule:

- alternatives should differ in at least two core items, or
- have a materially different silhouette/formality direction.

Do not send eight outfits that differ only by bag.

## 11.8 Client-side candidate boards

The wardrobe images live locally, so render candidate boards in the browser.

For each candidate:

- 512×640 transparent/white canvas;
- fixed category anchors matching the reference;
- use local cutout blobs;
- include candidate ID in metadata, not necessarily visibly;
- export WebP around quality 0.75–0.82;
- target under 100KB per board.

Send at most eight boards plus metadata to `/api/outfits/rank`. This keeps the request well below Vercel limits and avoids sending the entire wardrobe.

## 11.9 GPT-5.6 Sol ranking

Model:

```text
gpt-5.6
```

Use Responses API with image inputs and Structured Outputs. Set `store: false`, reasoning `low`.

Input:

- original user statement;
- structured DailyIntent;
- normalized weather;
- short preference summary;
- 8 candidate boards;
- candidate metadata.

Output schema:

```ts
const OutfitRankingResultSchema = z.object({
  rankedCandidateIds: z.array(z.string().uuid()).length(3),
  mainReason: z.string().max(120),
  alternativeReasons: z.array(z.string().max(120)).length(2),
});
```

Validate that every returned ID belongs to the provided set. If not, reject and fall back.

Prompt rules:

- choose only supplied candidate IDs;
- do not create or change items;
- respect hard constraints as already satisfied;
- select one decisive main outfit;
- alternatives should be meaningfully different;
- each reason under 18 English words;
- judge visual cohesion, context, comfort and the user’s nuanced request.

## 11.10 Fallback

If Sol fails, times out or returns invalid data:

- sort by deterministic score;
- select the top diverse three;
- generate short deterministic reasons from matched factors;
- keep the user flow working.

---

# 12. Revision engine

## 12.1 Targeted revision

Example: shoes.

1. lock every non-shoe item;
2. exclude current shoe;
3. filter candidate shoes;
4. score them;
5. if one clear winner exists, replace locally;
6. if several are close, render small candidates and reuse Sol ranking;
7. create a child `OutfitVersion`;
8. assert every unmentioned item ID is unchanged.

This invariant must have unit tests.

## 12.2 Overall revision

Example: “less mature.”

- translate the revision into style/formality deltas;
- generate candidates changing at most two core items;
- accessories may change;
- preserve at least half the core outfit when possible;
- rank locally or through Sol;
- record exactly changed and preserved IDs.

## 12.3 Undo

Undo selects `parentVersionId`. It never calls AI.

## 12.4 Focused item

When the user taps an item, store `focusedItemId`. Realtime tools can use it to resolve “this jacket” or “that bag.”

---

# 13. API contracts

Every route:

- uses Zod for request validation;
- uses Zod for response validation;
- returns a `requestId`;
- uses a common error envelope;
- does not expose provider error bodies;
- does not log secrets or images.

Error envelope:

```ts
type ApiError = {
  requestId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
};
```

## 13.1 `POST /api/realtime/token`

Request: empty or minimal client/session metadata.

Response:

```ts
{
  requestId: string;
  value: string;
}
```

No cache.

## 13.2 `POST /api/wardrobe/process`

Request: one multipart image.

Response:

```ts
{
  requestId: string;
  cutoutDataUrl: string;
  analysis: WardrobeAnalysis;
}
```

The client converts the data URL to a Blob immediately and does not persist the string.

Timeout target: 45 seconds client-side. Retry once for network/5xx.

## 13.3 `POST /api/outfits/rank`

Request:

```ts
{
  requestId: string;
  originalUtterance: string;
  intent: DailyIntent;
  preferences: PreferenceSummary;
  weather: WeatherContext | null;
  candidates: Array<{
    id: string;
    itemIds: string[];
    deterministicScore: number;
    boardDataUrl: string;
  }>;
}
```

Response:

```ts
{
  requestId: string;
  ranking: OutfitRankingResult;
}
```

Client timeout: about 20 seconds, with deterministic fallback.

## 13.4 `GET /api/weather`

Validated query params. Returns normalized `WeatherContext`.

## 13.5 `GET /api/health`

Returns configuration presence only:

- OpenAI configured;
- Photoroom configured;
- mock/live mode;
- version.

Never reveal secret values.

---

# 14. Mock architecture

All development begins in mock mode.

Interfaces:

```ts
interface WardrobeAnalyzer {
  analyze(input: Blob): Promise<WardrobeAnalysis>;
}

interface BackgroundRemovalService {
  remove(input: Blob): Promise<Blob>;
}

interface OutfitRanker {
  rank(input: RankInput): Promise<OutfitRankingResult>;
}

interface VoiceSessionAdapter {
  // defined above
}
```

Provide live and mock implementations.

Environment:

```text
AI_MODE=mock
NEXT_PUBLIC_VOICE_MODE=mock
```

Mock fixtures must reproduce:

- normal item analysis;
- low-confidence material;
- Photoroom failure;
- rank timeout;
- invalid rank ID;
- voice initial request;
- targeted bag revision;
- “too mature” revision;
- confirmation.

Automated tests never call live APIs.

---

# 15. Error and fallback behavior

## Microphone denied

Block core onboarding. Show permission guidance.

## Realtime connection failure

- Retry
- End session
- preserve current intent/outfit
- no full text-chat mode

## Upload too large

> **This photo is too large. Take a new photo or choose a smaller one.**

## Background removal failure

> **Something went wrong. We couldn’t process this item. Please try again.**

## Analysis failure

Keep cutout; request Category and Color manually.

## Empty wardrobe

> **Your wardrobe is empty**

> **Add your first items so YiYi can style them for you.**

## Insufficient structure

Tell the user exactly what category is missing, e.g. shoes.

## Weather failure

Continue without weather.

## Rank failure

Use deterministic result and say:

> **I’ve put together a simpler option for now.**

## Stale response

Ignore silently. Never overwrite a newer outfit.

## Session refresh

Recover today’s active/confirmed session from Dexie.

---

# 16. Privacy, security and abuse prevention

## 16.1 Privacy behavior

Local by default:

- wardrobe metadata and blobs remain in IndexedDB;
- only images currently being processed go to Photoroom/OpenAI;
- only candidate boards go to ranking;
- no account or cloud wardrobe.

Use `store: false` for Responses API requests.

Do not claim that providers retain nothing. Product privacy copy should honestly state that selected images are temporarily sent to AI providers to process the requested feature.

## 16.2 Secrets

Server-only:

- `OPENAI_API_KEY`
- `PHOTOROOM_API_KEY`
- optional Upstash credentials

Never use `NEXT_PUBLIC_` for secrets.

## 16.3 Logging

Log:

- request ID;
- route;
- duration;
- provider status category;
- model name;
- token/usage totals where available;
- error code.

Never log:

- image bytes/base64;
- raw voice audio;
- full wardrobe;
- full provider secret/token;
- sensitive freeform user content in production logs.

## 16.4 Rate limiting

P0 architecture includes an adapter, but production Upstash integration is P1.

```ts
interface RateLimiter {
  consume(key: string, action: string): Promise<boolean>;
}
```

Local default: no-op.  
Production when configured: Upstash Redis.

Suggested public-demo limits:

- Realtime tokens: 10/hour/IP;
- item processing: 20/hour/IP;
- ranking: 40/hour/IP.

If rate limiting is not configured, do not broadly advertise the public demo before the final recording.

## 16.5 CSP and headers

Configure:

- strict `Content-Security-Policy` allowing required OpenAI WebRTC/API connections;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy`;
- no caching on token/process/rank routes;
- HTTPS only in production.

Test Realtime connectivity after CSP changes.

---

# 17. Performance and cost

## Targets

- app shell interactive: under 2.5 seconds on normal mobile network;
- Realtime connect: visible feedback immediately, practical target under 3 seconds;
- initial recommendation: practical target 5–10 seconds;
- targeted revision: practical target 2–5 seconds;
- no main-thread image processing freeze longer than 100ms without visible feedback.

## Cost controls

- use `gpt-realtime-2.1-mini` during development;
- production demo uses `gpt-realtime-2.1`;
- use Terra for item analysis;
- call Sol only after deterministic narrowing;
- maximum 8 candidate boards;
- cache item analysis permanently;
- do not reanalyze unchanged items;
- disconnect voice promptly;
- mock by default;
- separate OpenAI project with budget limit;
- monitor usage after every live integration phase.

Photoroom cost is per background-removal call. Do not call it again unless the user requests reprocessing.

---

# 18. Testing

## 18.1 Unit tests

Required:

- category templates;
- one-piece substitutes top+bottom;
- shoes always present;
- accessories optional;
- unavailable/laundry exclusion;
- explicit category exclusion;
- required item preservation;
- weather filtering;
- walking shoe filtering;
- style-vector calculation;
- color score;
- diversity selection;
- targeted replacement preserves all other IDs;
- overall revision changes no more than allowed;
- undo uses parent version;
- stale request rejection;
- DailyIntent tag edit;
- preference memory rules;
- rank output ID validation.

## 18.2 Integration tests

With mocks:

1. first launch;
2. teaching onboarding;
3. microphone granted mock;
4. style calibration;
5. seed example wardrobe;
6. voice fixture produces DailyIntent;
7. recommendation appears;
8. bag revision;
9. confirmation;
10. refresh recovers confirmed outfit.

Image path:

1. select fixture image;
2. process mock;
3. low-confidence field appears;
4. edit color/material;
5. save;
6. grid updates.

## 18.3 Playwright

Run Chromium and WebKit projects.

Critical E2E:

- example wardrobe full loop;
- manual intent correction;
- targeted revision;
- fallback ranking;
- upload failure;
- empty wardrobe;
- iPhone viewport safe-area screenshots.

Real Realtime audio is a manual test, not CI.

## 18.4 Real iPhone test matrix

Minimum:

- Safari normal tab;
- added to Home Screen;
- microphone allow/deny;
- native camera;
- photo library JPEG;
- HEIC;
- background/resume;
- interruption while YiYi speaks;
- Dynamic Island safe area;
- smallest supported viewport;
- refresh and IndexedDB recovery.

Use Safari Remote Web Inspector for debugging.

## 18.5 Commands

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm build"
}
```

Adapt `lint` to the generated Next.js version if its CLI differs. Do not disable lint/type errors to make the build pass.

---

# 19. Environment variables

`.env.example`:

```dotenv
# Server only
OPENAI_API_KEY=
OPENAI_ITEM_MODEL=gpt-5.6-terra
OPENAI_RANK_MODEL=gpt-5.6
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_REALTIME_VOICE=marin
PHOTOROOM_API_KEY=

# Modes
AI_MODE=mock
NEXT_PUBLIC_VOICE_MODE=mock
NEXT_PUBLIC_SEED_DEMO_WARDROBE=true
NEXT_PUBLIC_ENABLE_CUTOUT_EDITOR=false

# Optional production rate limit
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Production demo:

- `AI_MODE=live`
- `NEXT_PUBLIC_VOICE_MODE=live`
- `OPENAI_REALTIME_MODEL=gpt-realtime-2.1`

Do not commit `.env.local`.

---

# 20. Development order for Codex

The purpose of this order is to avoid debugging UI, voice, AI and recommendation simultaneously.

## Phase 0 — contracts and scaffold

Deliver:

- clean repository;
- Next.js/TypeScript/Tailwind;
- design tokens;
- scripts;
- testing;
- CI;
- repository documents;
- `.env.example`;
- reference-image audit note.

Acceptance:

- `pnpm verify` passes;
- no business implementation;
- no copied old-project files.

## Phase 1 — complete static product in mock mode

Deliver every reference page/state using fixtures:

- splash;
- onboarding;
- permission gate;
- style calibration;
- wardrobe;
- item review and sheets;
- Today voice states;
- result carousel;
- revision animation;
- confirmation;
- empty/error states.

Acceptance:

- visual comparison at iPhone viewports;
- all copy English;
- no dead navigation;
- Playwright static flow passes.

## Phase 2 — Dexie and example wardrobe

Deliver schemas, DB, seed/reset, daily session recovery.

Acceptance:

- refresh retains wardrobe/preferences/outfit;
- reset works;
- blobs use Blob, not Data URL;
- migration test passes.

## Phase 3 — deterministic recommendation and revision

Deliver hard filters, templates, scores, diversity, versions and undo.

Acceptance:

- all domain unit tests pass;
- full recommendation works without any AI;
- targeted replacement invariant passes.

## Phase 4 — image pipeline

Deliver native picker, queue, preprocessing, Photoroom adapter, Terra analysis, item review and save.

Acceptance:

- JPEG, PNG, WebP and HEIC path tested on real iPhone;
- request/response sizes logged locally;
- no route exceeds Vercel limit;
- analysis output validated;
- failure fallback works.

## Phase 5 — GPT-5.6 Sol visual ranking

Deliver board renderer, rank route, structured output and fallback.

Acceptance:

- model cannot invent IDs;
- one main + two alternatives;
- timeout fallback;
- Build Week GPT-5.6 use is clearly traceable in code.

## Phase 6 — Realtime voice

Deliver token route, Agents SDK adapter, strict tools, semantic VAD/interruption, transcript and session cleanup.

Acceptance:

- live request calls recommendation;
- user can interrupt;
- targeted voice revision changes correct item;
- no secret in browser;
- no raw WebRTC implementation.

## Phase 7 — hardening

Deliver real iPhone fixes, storage checks, privacy copy, optional rate limit, optional cutout editor.

Acceptance:

- complete live demo performed three times consecutively;
- no broken P0 control;
- production build and Vercel deploy pass.

## Phase 8 — Build Week submission

Deliver:

- public demo;
- repository access;
- README;
- sample/demo wardrobe;
- architecture diagram;
- asset attribution;
- 3-minute-or-less public YouTube video;
- English narration;
- `/feedback` Session ID;
- Devpost description.

No feature work on submission day unless fixing a blocking defect.

---

# 21. Codex working protocol

## 21.1 One primary thread

Use one main Codex thread for most core development so the required `/feedback` Session ID is representative.

Separate review threads may inspect code but must not concurrently edit the same module.

## 21.2 Every task prompt must contain

- Goal
- Files allowed to change
- Contracts that cannot change
- Acceptance criteria
- Tests to run
- Explicit non-goals

Do not ask Codex to “build the whole app” in one pass.

## 21.3 Task behavior

Before coding, Codex must:

1. read `AGENTS.md`;
2. read relevant spec sections;
3. inspect existing files;
4. state a short plan;
5. identify contract conflicts.

After coding, Codex must:

1. run relevant tests;
2. run typecheck;
3. report exact files changed;
4. report remaining risks;
5. not claim success if a command failed.

## 21.4 Change discipline

- no unrelated refactors;
- no dependency added without justification;
- no `any` to bypass external SDK typing;
- no duplicated taxonomy;
- no duplicated UI copy;
- no silent API fallback that changes product behavior;
- no real API calls in unit/E2E tests;
- one coherent commit per task.

Suggested commit prefixes:

- `chore:`
- `feat(ui):`
- `feat(storage):`
- `feat(wardrobe):`
- `feat(recommendation):`
- `feat(voice):`
- `test:`
- `docs:`
- `fix:`

---

# 22. Build Week obligations

Deadline: July 21, 2026 at 5:00 PM PDT.

Recommended track:

> **Apps for Your Life**

Submission must include:

- working project using Codex and GPT-5.6;
- project description;
- public YouTube demo, 3 minutes or under;
- voiceover explaining the product, Codex use and GPT-5.6 use;
- repository URL;
- public repository with licensing or private repository shared with required judging emails;
- README setup/test/sample-data instructions;
- `/feedback` Codex Session ID from the primary build thread.

README must explicitly explain:

- why YiYi is not a traditional digital closet;
- how Codex accelerated architecture, implementation, testing and debugging;
- where key human product decisions were made;
- how GPT-5.6 Terra analyzes clothes;
- how GPT-5.6 Sol visually ranks legal candidates;
- how Realtime voice calls deterministic tools;
- how the project was built clean-room from a new repository;
- how judges can use the example wardrobe without uploading personal data.

The demo video should show, in order:

1. problem in one sentence;
2. opening YiYi;
3. user describes the day;
4. understanding tags;
5. main outfit appears;
6. user says bag is too formal;
7. only bag changes;
8. user confirms;
9. brief architecture/Codex/GPT-5.6 explanation.

---

# 23. Definition of done

The competition build is done only when:

- a judge can open the URL on an iPhone;
- microphone permission works;
- example wardrobe loads;
- the user can speak a complete day description;
- intent tags appear and can be corrected;
- one main and two alternatives appear;
- GPT-5.6 is meaningfully involved;
- targeted voice revision preserves unmentioned items;
- confirmation persists after refresh;
- live AI failure still produces a deterministic outfit;
- all visible copy is English;
- reference design is recognizably implemented;
- secrets are server-side;
- three consecutive live demo rehearsals succeed;
- README, video, repository and `/feedback` ID are ready.

---

# 24. Decisions that must not be reopened during P0

1. iPhone-first web app, not native.
2. English product.
3. Continuous live voice, not voice-message sending.
4. Microphone required.
5. One decisive main recommendation, two weaker alternatives.
6. Accessories included.
7. AI cutout required.
8. No clothing-name confirmation.
9. Local-first Dexie, no account/cloud sync.
10. Native iOS camera/picker, not custom camera.
11. Official Agents SDK for Realtime.
12. Terra analyzes items.
13. Deterministic code creates legal candidates.
14. Sol only ranks candidates.
15. Revision preserves unmentioned items.
16. No virtual try-on.
17. Mock-first Codex development.
18. New clean-room repository.
19. UI references are visual source, not production assets.
20. No P2 feature before submission.

---

# 25. Verified external references

Codex should consult the current official documentation when an SDK signature differs from this document.

OpenAI:

- https://openai.github.io/openai-agents-js/guides/voice-agents/quickstart/
- https://openai.github.io/openai-agents-js/guides/voice-agents/build/
- https://openai.github.io/openai-agents-js/guides/voice-agents/transport/
- https://openai.github.io/openai-agents-js/guides/tools/
- https://developers.openai.com/api/docs/models/gpt-realtime-2.1
- https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://platform.openai.com/docs/models/default-usage-policies-by-endpoint

Photoroom:

- https://docs.photoroom.com/remove-background-api-basic-plan
- https://docs.photoroom.com/remove-background-api-basic-plan/background-color-size-and-crop
- https://docs.photoroom.com/remove-background-api-basic-plan/which-image-sizes-and-formats-are-supported
- https://docs.photoroom.com/api-reference-openapi

Vercel and WebKit:

- https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
- https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
- https://webkit.org/blog/17333/webkit-features-in-safari-26-0/

Build Week:

- https://openai.com/build-week/
- https://openai.devpost.com/details/faqs

---

# 26. Immediate first action

Do not begin with live AI.

First:

1. initialize the clean repository;
2. copy this document, `AGENTS.md` and the reference images into the repository;
3. split stable contracts into the six root documents;
4. scaffold the project;
5. implement the complete static mock flow;
6. verify on iPhone-sized WebKit;
7. only then integrate persistence and live services.

The first Codex prompt is provided separately in `CODEX_KICKOFF_PROMPT.md`.
