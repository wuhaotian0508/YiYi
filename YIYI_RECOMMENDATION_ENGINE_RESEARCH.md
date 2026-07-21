# YiYi Recommendation Engine Research & Architecture

> **Recommended repository location:** `docs/YIYI_RECOMMENDATION_ENGINE_RESEARCH.md`  
> **Audience:** Codex and future YiYi engineers  
> **Status:** Architecture decision and implementation reference  
> **Scope:** Recommendation correctness, compatibility, personalization, revisions, fallback, evaluation, and future evolution  
> **Non-goal:** This document does not prescribe the visual UI implementation.

---

## 0. Executive decision

YiYi should not use a single “magic outfit model,” a pure rule engine, or an unconstrained multimodal LLM as its recommendation core.

The recommended architecture is:

> **Constraint-first multimodal personalized search**  
> **Structured intent → unified context → hard-constraint compiler → anchor-driven candidate search → deterministic compatibility scoring → diversity filtering → multimodal visual reranking → one final outfit → feedback learning**

In compact form:

```text
User speech
    ↓
Realtime agent → structured IntentDelta
    ↓
Merge weather + schedule + wardrobe + profile + session state
    ↓
RecommendationContext
    ↓
HardConstraintCompiler + validateOutfit()
    ↓
Anchor-driven beam search
    ↓
Deterministic structured scoring
    ↓
Diversity filtering
    ↓
Top 6–8 rendered outfit boards
    ↓
Sol listwise visual reranking
    ↓
One final outfit + ScoreTrace
    ↓
Revision / confirm / feedback
    ↓
History stack + personalization update
```

This architecture is recommended because it matches YiYi’s actual product conditions:

- The user’s wardrobe is small enough for constrained search.
- The app must obey explicit instructions with effectively zero tolerance for violations.
- Fashion compatibility is nonlinear and visual, so deterministic rules alone are insufficient.
- User data is initially sparse, so collaborative filtering and reinforcement learning are premature.
- YiYi promises **one decisive answer**, not a list that transfers the decision back to the user.
- The system must support natural-language revisions, exact undo, weather, availability, and personalized style.

The core principle is:

> **Models interpret and judge; deterministic code enforces and executes.**

Realtime interprets language. Terra extracts structured garment information. Deterministic TypeScript code owns constraints, search, state, history, and validation. Sol judges the final visual coherence among already-legal candidates. No model may invent wardrobe IDs or override hard constraints.

---

## 1. The actual recommendation problem

YiYi is not a conventional e-commerce recommender.

A typical e-commerce recommender asks:

> “Among millions of products, which items is this user likely to click or buy?”

YiYi asks:

> “Given this user’s actual available wardrobe, today’s weather and schedule, their current energy and spoken preferences, what is the single best legal outfit to wear now?”

This is a constrained decision problem with six interacting objectives:

1. **Feasibility:** every selected item must exist, be available, and satisfy hard constraints.
2. **Context:** the outfit must suit weather, walking, occasion, location, and schedule.
3. **Compatibility:** the garments must work together in color, silhouette, material, formality, and styling.
4. **Personalization:** the outfit must reflect the user’s style rather than an average fashion prior.
5. **Continuity:** revisions must preserve everything the user did not ask to change.
6. **Decisiveness:** YiYi must return one answer and explain it clearly.

These objectives have different levels of authority.

### 1.1 Hard constraints

Hard constraints determine whether an outfit is legal at all.

Examples:

- an item is in laundry or unavailable;
- the user explicitly requires or excludes an item;
- the user says “never heels”;
- rain excludes dry-only shoes;
- a targeted revision must preserve non-target slots;
- a top + bottom outfit cannot also contain a one-piece;
- the same item cannot occupy multiple slots.

A high aesthetic score can never compensate for a hard-constraint violation.

### 1.2 Soft objectives

Soft objectives determine which legal outfit is better.

Examples:

- slightly more polished;
- more comfortable;
- closer to a preferred color palette;
- less repetitive than yesterday;
- visually more coherent;
- more photo-ready;
- more aligned with a style anchor.

Soft objectives should be weighted by the current request. “I’ll be walking all day” must raise comfort and walking suitability. “I need to present” must raise formality and structure.

---

## 2. Non-negotiable system invariants

Every implementation and test should preserve these invariants.

### 2.1 Legality invariants

1. Every outfit item ID exists in the current wardrobe.
2. Every selected item is available.
3. Every required item is present.
4. Every excluded item and category is absent.
5. Hard preference rules are applied deterministically.
6. Weather exclusions remain active during initial recommendation, targeted revision, global revision, random replacement, and fallback.
7. An outfit has exactly one legal core structure:
   - `top + bottom`, or
   - `onePiece`.
8. Shoes are required unless the product explicitly supports an exceptional context.
9. No item occupies more than one slot.
10. A targeted revision changes only the target slot unless a core-structure transition is explicitly promoted to a global revision.

### 2.2 State invariants

1. The screen shows exactly one current outfit.
2. Undo restores the exact previous displayed state; it does not generate a new recommendation.
3. Every mutation uses the version that was current when the operation began.
4. A stale asynchronous result cannot overwrite a newer state.
5. An outfit is added to history only after its version is successfully persisted.
6. Confirmation, history, current version, and worn timestamps are committed atomically where possible.

### 2.3 Model-boundary invariants

1. Realtime returns structured intent, not arbitrary item decisions.
2. Terra returns structured garment features with confidence and provenance.
3. Sol selects only from supplied legal candidate IDs.
4. Invalid model output is rejected.
5. Fallback remains fully legal and never silently weakens hard constraints.
6. Explanations derive from the actual scoring and constraints, not post-hoc invention.

---

## 3. What industry and research suggest

Fashion recommendation research has evolved through several useful ideas. YiYi should adopt their principles selectively rather than copy a research model wholesale.

### 3.1 Outfit-level context matters

Pairwise compatibility is insufficient because the suitability of one garment depends on the rest of the outfit. Context-aware graph models and set-based transformers show that outfit-level relationships improve compatibility prediction.

**Implication for YiYi:** do not score garments independently and add the scores. The engine needs pairwise and whole-outfit features, and Sol should inspect a complete rendered outfit board.

### 3.2 Self-attention is useful for learning whole-outfit representations

OutfitTransformer models an outfit as an unordered set and uses self-attention for compatibility and complementary-item retrieval.

**Implication for YiYi:** this is a strong long-term research direction, but training and serving a dedicated model is not justified for the competition MVP. Sol can approximate outfit-level visual judgment now, while deterministic features and tests create a reliable foundation.

### 3.3 Beam search is appropriate for outfit composition

Research on scalable outfit generation uses a desired composition and beam search to expand outfits efficiently.

**Implication for YiYi:** replace “take the top four of each category and enumerate” with anchor-driven beam search, validating and pruning partial outfits at every stage.

### 3.4 Personalization needs multiple preference anchors

Learnable-anchor research addresses cold-start users with very little data by combining general preference anchors with user-specific anchors.

**Implication for YiYi:** do not compress a person into one average style vector. Maintain a small set of style anchors and shrink uncertain personal estimates toward neutral priors.

### 3.5 Text control should be represented at multiple semantic levels

Text-to-outfit research distinguishes item-level, style-level, and outfit-level semantics.

**Implication for YiYi:** parse speech into structured dimensions:
- item constraints;
- slot preservation;
- warmth, comfort, formality, colorfulness, layering;
- style tags;
- full-outfit intent.

### 3.6 Evaluation must test behavior, not only average accuracy

RecList argues that aggregate offline accuracy can hide failures on rare items, cold-start users, and logically asymmetric relations.

**Implication for YiYi:** build a domain-specific behavioral test suite. For YiYi, zero hard-constraint violations and exact revision semantics matter more than a generic compatibility metric.

### 3.7 Constraint solvers are conceptually relevant, but unnecessary now

Google OR-Tools CP-SAT is powerful for Boolean and integer constraint models.

**Decision:** adopt constraint-programming discipline—explicit variables, predicates, and reasons—but keep the current implementation in TypeScript. YiYi’s wardrobe is small, its visual objective is nonlinear, and adding a Python solver service would increase complexity without clear MVP benefit. The architecture should remain compatible with a future solver if wardrobe size or constraint complexity grows substantially.

### 3.8 Collaborative filtering and contextual bandits are future tools

RecBole and Recommenders provide mature experimentation frameworks. Vowpal Wabbit supports contextual bandits and offline policy evaluation.

**Decision:** do not use collaborative filtering or bandits now. YiYi lacks enough users, shared item IDs, and interaction history. Exploration that intentionally serves a lower-confidence outfit would also conflict with the promise of a decisive morning assistant. Revisit contextual bandits after meaningful real-world feedback volume exists.

---

## 4. Recommended domain model

The current data model should evolve only where a field has a clear algorithmic use.

### 4.1 Garment features

```ts
type ItemFeatures = {
  id: string;

  category:
    | "top"
    | "bottom"
    | "one_piece"
    | "outerwear"
    | "shoes"
    | "bag"
    | "jewelry"
    | "headwear"
    | "scarf"
    | "belt"
    | "eyewear"
    | "hair_accessory"
    | "other_accessory";

  subtype?: string;
  structuralRole:
    | "top"
    | "bottom"
    | "onePiece"
    | "outerwear"
    | "shoes"
    | "bag"
    | "accessory";

  colors: Array<{
    name: string;
    proportion: number;
    lab?: [number, number, number];
  }>;

  pattern:
    | "solid"
    | "striped"
    | "checked"
    | "graphic"
    | "floral"
    | "textured"
    | "other";

  materialTags: string[];
  silhouetteTags: string[];
  fitTags: string[];
  styleTags: string[];
  occasionTags: string[];
  weatherTags: string[];

  formality: number;          // normalized 0–1
  warmth: number;             // normalized 0–1
  comfort: number;            // normalized 0–1
  walkingSuitability: number; // normalized 0–1

  metal?: "gold" | "silver" | "mixed" | "none";

  availability: "available" | "laundry" | "unavailable";
  unavailableReason?: string;

  lastWornAt?: number;
  wornCount?: number;

  confidence: Partial<Record<
    | "category"
    | "colors"
    | "pattern"
    | "material"
    | "silhouette"
    | "fit"
    | "formality"
    | "warmth"
    | "comfort"
    | "style",
    number
  >>;

  provenance: Partial<Record<string, "terra" | "user" | "derived">>;
};
```

Rules:

- Terra should output features through Structured Outputs.
- Every uncertain visual property should carry confidence.
- User corrections override model values and change provenance to `user`.
- A low-confidence feature should contribute less to soft scoring.
- Hard constraints should not depend on an uncertain inferred feature unless confirmed or safely conservative.

### 4.2 Structured daily intent

```ts
type DailyIntent = {
  rawUtterance: string;

  occasionTags: string[];
  aestheticTerms: string[];

  desiredFormality?: number; // 0–1
  comfortPriority: number;   // 0–1
  walkingIntensity: number;  // 0–1
  photoPriority: number;     // 0–1

  requiredItemIds: string[];
  excludedItemIds: string[];
  excludedCategories: string[];

  temporaryPreferences: PreferenceRule[];

  confidence: number;
  ambiguity?: string[];
};
```

### 4.3 Structured revision delta

Natural-language revisions must not be interpreted by a handful of local regexes.

```ts
type IntentDelta = {
  operation:
    | "initial"
    | "targeted_revision"
    | "global_revision"
    | "random_new_outfit"
    | "undo"
    | "confirm";

  targetSlots?: OutfitSlot[];
  preserveSlots: OutfitSlot[];

  requiredItemIds: string[];
  excludedItemIds: string[];
  excludedCategories: string[];

  adjustments: {
    formalityDelta?: number;       // -1 to +1
    warmthDelta?: number;
    comfortDelta?: number;
    colorfulnessDelta?: number;
    walkingPriorityDelta?: number;
    layeringDelta?: number;
    structureDelta?: number;
  };

  desiredStyleTags: string[];
  undesiredStyleTags: string[];

  rawUtterance: string;
  confidence: number;
  ambiguity?: string[];
};
```

The Realtime agent should call a strict tool with this shape. Deterministic code validates the delta, merges it with current state, and executes it.

### 4.4 Unified recommendation context

```ts
type RecommendationContext = {
  intent: DailyIntent;
  profile: PreferenceProfile;
  weather: WeatherContext | null;
  schedule?: ScheduleContext;

  currentOutfit?: Outfit;
  focusedSlot?: OutfitSlot;

  requiredItemIds: Set<string>;
  excludedItemIds: Set<string>;
  excludedCategories: Set<ItemCategory>;
  hardRules: CompiledHardRule[];

  preserveSlots: Set<OutfitSlot>;
  targetSlots: Set<OutfitSlot>;

  shownOutfitIds: Set<string>;
  recentWornOutfitSignatures: string[];

  operation:
    | "initial"
    | "targeted_revision"
    | "global_revision"
    | "random_new_outfit"
    | "fallback";

  requestId: string;
  operationId: number;
};
```

Every generation path must receive the same `RecommendationContext`.

### 4.5 Outfit and score trace

```ts
type ScoreTrace = {
  dimensions: {
    contextFit: number;
    personalFit: number;
    structuredCompatibility: number;
    comfortPracticality: number;
    novelty: number;
    revisionCompliance: number;
    visualScore?: number;
  };

  hardConstraintChecks: Array<{
    rule: string;
    passed: boolean;
    itemIds?: string[];
  }>;

  positives: string[];
  tradeoffs: string[];
  warnings: string[];

  deterministicTotal: number;
  finalTotal?: number;
  scoringVersion: string;
};

type OutfitCandidate = {
  id: string;
  itemIds: OutfitItemIds;
  deterministicScore: number;
  scoreTrace: ScoreTrace;
};
```

The user-facing reason should be generated from the trace and then checked against the actual selected items.

---

## 5. Unified hard-constraint engine

### 5.1 One validator for every path

Create a single canonical function:

```ts
function validateOutfit(
  outfit: OutfitItemIds,
  wardrobeIndex: WardrobeIndex,
  context: RecommendationContext,
): ValidationResult
```

```ts
type ValidationResult = {
  valid: boolean;
  violations: Array<{
    code: string;
    message: string;
    itemIds?: string[];
    slots?: OutfitSlot[];
  }>;
};
```

It must be used by:

- initial recommendation;
- targeted revision;
- global revision;
- random new outfit;
- deterministic fallback;
- restored persisted state before display;
- confirmation before marking items worn.

### 5.2 Core structure rules

Legal templates:

```text
Separates:
top + bottom + shoes
top + bottom + outerwear + shoes
top + bottom + shoes + optional accessories

One-piece:
onePiece + shoes
onePiece + outerwear + shoes
onePiece + shoes + optional accessories
```

Invalid:

```text
top + bottom + onePiece
top without bottom
bottom without top
onePiece plus top or bottom
missing shoes
duplicate item ID in multiple slots
```

A revision between `top + bottom` and `onePiece` is a structural transition. It must be performed atomically or promoted to a global revision.

### 5.3 Required items before pruning

Required items must be injected before shortlist or beam pruning.

Bad:

```text
rank items → take top four → generate combinations → filter required item
```

Correct:

```text
compile required anchors
→ select legal templates containing them
→ expand around them
→ prune only among candidates that preserve them
```

If required items conflict, return a typed conflict:

```ts
{
  code: "CONFLICTING_REQUIRED_ITEMS",
  details: ["onePiece cannot be combined with required top and bottom"]
}
```

Do not misreport the problem as “not enough clothes.”

### 5.4 Hard preference compilation

Natural-language hard avoids must be compiled into executable predicates.

Examples:

```text
“never heels”
→ category/subtype predicate

“no leather”
→ material predicate

“avoid gold jewelry”
→ category + metal predicate

“nothing cropped”
→ fit/silhouette predicate
```

If a rule cannot be compiled with adequate confidence, it should remain a visible soft rule or ask for clarification. It must not be labeled “hard” while existing only in a prompt sent to Sol.

---

## 6. Candidate generation: anchor-driven beam search

### 6.1 Why beam search

Full enumeration grows rapidly:

```text
tops × bottoms × shoes × outerwear × bags × accessories
```

The current wardrobe may be small, but brute-force enumeration followed by arbitrary category truncation creates blind spots and excludes required or unusual pieces.

Beam search allows the engine to:

- start from required or contextually important anchors;
- validate partial outfits immediately;
- preserve diverse high-quality branches;
- avoid expensive full enumeration;
- support one-piece and separates templates cleanly.

### 6.2 Anchor selection

Anchor priority:

1. explicitly required item;
2. focused item in a revision;
3. preserved core item;
4. weather-critical item;
5. schedule-critical item;
6. highest contextual + personal score core item.

Multiple required items form a partial anchor outfit.

### 6.3 Template selection

Select only templates compatible with the anchors.

Examples:

- required one-piece → one-piece templates only;
- required top → separates templates;
- required outerwear → both structures may remain possible;
- required headwear → attach it as a required accessory while selecting a legal core.

### 6.4 Expansion order

Recommended default:

```text
anchor
→ missing core garment
→ shoes
→ outerwear
→ bag
→ accessory
```

The order may change with context. In heavy rain, shoes or outerwear may be selected earlier.

### 6.5 Partial validation and scoring

At every expansion:

1. reject partial candidates that can no longer satisfy hard constraints;
2. calculate a partial score;
3. retain a diverse beam.

Illustrative parameters:

```ts
const BEAM_WIDTH = 40;
const FINAL_CANDIDATE_LIMIT = 80;
```

These are starting points, not permanent truths. Tune with measured latency and candidate quality.

### 6.6 Pseudocode

```ts
function generateCandidates(context: RecommendationContext): OutfitCandidate[] {
  const anchors = selectAnchors(context);
  const templates = selectLegalTemplates(anchors, context);

  let beam: PartialCandidate[] = templates.map((template) =>
    seedTemplate(template, anchors)
  );

  for (const stage of expansionPlan(context)) {
    const expanded: PartialCandidate[] = [];

    for (const partial of beam) {
      for (const item of legalItemsForStage(stage, partial, context)) {
        const next = addItem(partial, stage.slot, item);

        if (!validatePartial(next, context).valid) continue;

        expanded.push({
          ...next,
          partialScore: scorePartial(next, context),
        });
      }

      if (stage.optional) {
        expanded.push(partial);
      }
    }

    beam = selectDiverseBeam(expanded, BEAM_WIDTH);
  }

  return beam
    .filter((candidate) => validateOutfit(candidate.itemIds, context).valid)
    .map((candidate) => scoreCompleteCandidate(candidate, context))
    .sort(byDeterministicScoreDesc)
    .slice(0, FINAL_CANDIDATE_LIMIT);
}
```

---

## 7. Deterministic structured scoring

The deterministic score should be interpretable and tunable.

Suggested top-level dimensions:

```text
Deterministic score =
  Context fit
+ Personal fit
+ Structured compatibility
+ Comfort / practicality
+ Novelty
+ Revision compliance
```

Do not permanently encode a single fixed percentage table. Use a weight policy generated from the current intent.

Example baseline:

```ts
type ScoreWeights = {
  contextFit: number;
  personalFit: number;
  structuredCompatibility: number;
  comfortPracticality: number;
  novelty: number;
  revisionCompliance: number;
};
```

```text
Baseline:
contextFit              0.28
personalFit             0.22
structuredCompatibility 0.24
comfortPracticality     0.14
novelty                 0.06
revisionCompliance      0.06
```

Dynamic changes:

- “walking all day” raises comfort and shoe suitability;
- “presentation” raises occasion and formality fit;
- “keep the shoes” turns preservation into a hard condition;
- “random new outfit” raises novelty;
- targeted revision gives revision compliance dominant authority.

### 7.1 Context fit

Features:

- apparent temperature range;
- rain and wind;
- indoor/outdoor;
- walking;
- occasion;
- schedule formality;
- photo priority;
- expected duration;
- optional morning/evening temperature spread.

Weather should use a continuous comfort model rather than only `expectedRain && dry_only`.

Example:

```ts
temperaturePenalty =
  abs(outfitWarmth - desiredWarmth(weather, activity, indoorOutdoor));
```

### 7.2 Personal fit

Features:

- distance to the best matching style anchor;
- preferred and disliked style tags;
- color tendencies;
- fit/silhouette preferences;
- metal preference;
- learned comfort and formality bias;
- confidence-weighted evidence.

### 7.3 Structured compatibility

This must evaluate relationships between garments.

#### Color

- dominant, secondary, accent colors;
- Lab distance or another perceptual color distance;
- saturation and lightness balance;
- neutral support;
- pattern count;
- accent overload.

Avoid simplistic “same color is always good.” Intentional contrast can score well.

#### Silhouette and proportion

- fitted vs oversized balance;
- top/bottom visual volume;
- length interaction;
- outerwear-to-inner-layer proportion;
- one-piece and outerwear proportion;
- repeated bulk.

#### Material and season

- material weight consistency;
- intentional texture contrast;
- excessive shine;
- season mismatch;
- rain and material suitability.

#### Formality structure

Evaluate mean and spread. Some contrast is intentional; extreme accidental mismatch should be penalized.

#### Accessories

- bag/shoe formality relation;
- metal consistency;
- number of focal points;
- accessory usefulness;
- optional omission if an accessory lowers the score.

Do not assign bags or jewelry with modulo indexing. They must compete on compatibility.

### 7.4 Comfort and practicality

- shoe walking suitability;
- garment comfort;
- warmth;
- layering;
- weather protection;
- context-specific practicality.

### 7.5 Recency and novelty

Use time decay rather than a binary “ever worn” penalty.

Example:

```text
worn in last 1–2 days: strong penalty
worn within one week: moderate penalty
worn several weeks ago: small or no penalty
same core combination recently: additional penalty
```

Do not penalize a required or explicitly preferred item merely because it was worn recently.

### 7.6 Confidence-aware scoring

If Terra is only 0.55 confident about a garment’s material, material compatibility should be discounted.

```ts
effectiveContribution = rawContribution * featureConfidence;
```

User-confirmed properties receive confidence 1.

---

## 8. Diversity filtering

Before Sol reranking, avoid sending eight near-duplicate candidates.

Use a simple maximal marginal relevance objective:

```text
MMR(candidate) =
  quality(candidate)
- λ × maxSimilarity(candidate, selectedCandidates)
```

Outfit similarity may include:

- shared core items;
- shared structure;
- color palette similarity;
- style-anchor similarity;
- silhouette similarity.

The diversity filter exists to give Sol meaningful alternatives, not to expose alternatives to the user.

---

## 9. Sol as a visual reranker

### 9.1 Correct responsibility

Sol should judge visual coherence among legal candidates. It must not:

- invent items;
- modify candidates;
- decide hard constraints;
- receive illegal candidates;
- override required or preserved items.

### 9.2 Input flow

```text
up to 80 legal candidates
→ deterministic top 24
→ diversity filter
→ 6–8 rendered outfit boards
→ Sol listwise ranking
```

### 9.3 Structured output

```ts
type VisualRanking = {
  selectedCandidateId: string;

  candidateScores: Array<{
    candidateId: string;
    visualCoherence: number;
    colorBalance: number;
    silhouetteBalance: number;
    materialHarmony: number;
    styleClarity: number;
    concerns: string[];
  }>;

  conciseReason: string;
};
```

Validate every returned ID.

### 9.4 Final score

Start with a conservative blend:

```text
Final score =
  deterministic score × 0.65
+ normalized visual score × 0.35
```

This ratio is a tunable baseline. Do not let the visual component rescue a candidate with weak context or practical fit.

An alternative is to let Sol choose among the deterministic top set, while deterministic code remains the fallback. Compare both approaches with a human evaluation set.

### 9.5 Board-size handling

Do not silently fail because a Data URL exceeds a fixed schema limit.

Required behavior:

1. measure encoded byte size;
2. compress or resize progressively;
3. record a typed `BOARD_TOO_LARGE` diagnostic;
4. preserve a legal deterministic fallback;
5. expose model and fallback source in diagnostics.

---

## 10. Personalization architecture

### 10.1 Calibration looks must have semantic features

Each onboarding look needs machine-readable features.

```ts
type CalibrationLook = {
  id: string;
  wardrobeDirection: "womenswear" | "menswear" | "mixed" | "neutral";

  vector: {
    relaxedPolished: number;
    minimalExpressive: number;
    classicTrendy: number;
    neutralColorful: number;
    fittedOversized: number;
    feminineMasculine: number;
  };

  styleTags: string[];
  colors: string[];
  silhouettes: string[];
};
```

Feedback updates the features of the selected look, not merely a count.

```text
More like this → positive evidence
Not for me    → negative evidence
Skip          → no preference update
```

### 10.2 Multiple style anchors

```ts
type StyleAnchor = {
  id: string;
  label?: string;

  vector: StyleVector;
  styleTags: Record<string, number>;

  evidenceCount: number;
  confidence: number;
  updatedAt: number;
};
```

Maintain two to four anchors. Examples:

- clean casual;
- relaxed tailoring;
- expressive evening;
- practical sporty.

A user’s preferred style for a presentation may differ from their preferred weekend style. Averaging everything into one vector can create a bland middle.

### 10.3 Cold-start shrinkage

Use a neutral or general prior when evidence is limited.

```text
effectivePreference =
  generalPrior × (1 - confidence)
+ observedPreference × confidence
```

Confidence rises with independent evidence, not just repeated clicks in one onboarding session.

### 10.4 Permanent vs contextual preferences

Classify feedback:

**Permanent or long-lived**
- “I never wear heels.”
- “I prefer silver jewelry.”
- repeated dislike of cropped tops.

**Contextual**
- “Not today.”
- “I’ll walk a lot.”
- removing a warm coat because today is hot.

Do not turn every revision into a permanent preference.

### 10.5 Feedback weights

Illustrative evidence:

```text
Confirmed and worn                     strong positive
Explicit “I like this”                 positive
Preserved item during several changes  mild positive
Targeted replacement                   mild negative for this context
Rejected whole outfit                  negative
Undo after change                      mild negative
Explicit hard avoid                    deterministic rule
```

These values should be configurable and evaluated; they should not be scattered as magic numbers.

---

## 11. Revision semantics

### 11.1 Targeted revision

Example: “Change the shoes.”

Algorithm:

1. freeze all non-target slots;
2. compile the full current context;
3. enumerate legal replacements for the target category;
4. validate each complete revised outfit;
5. score compatibility with the fixed outfit;
6. choose one replacement;
7. persist the old state to history and the new version atomically;
8. display the new outfit.

If no legal improvement exists, return a clear failure rather than changing unrelated items.

### 11.2 Structural targeted requests

“Change this top to a dress” is not a normal one-slot replacement.

Promote to a structural global revision:

```text
top + bottom → onePiece
```

The transition must remove the old core and add the new legal core atomically.

### 11.3 Global revision

Example: “Make it warmer but keep the shoes.”

1. Realtime returns a structured delta:
   - warmth increase;
   - preserve shoes.
2. Merge into the recommendation context.
3. Regenerate legal candidates.
4. Validate preservation and all constraints.
5. show one new result.
6. push the previous state to history.

### 11.4 Random new outfit

“Random” should mean diverse but still high quality.

Rules:

1. exclude the current outfit;
2. prefer excluding all outfits already shown in this session;
3. penalize recently shown core items and structures;
4. maximize diversity within a reasonable quality band;
5. never weaken hard constraints.

```text
random score =
  quality
- λ1 × similarity to current
- λ2 × similarity to session history
+ small seeded stochastic term
```

Use a seed tied to request/session for reproducible tests.

### 11.5 Undo

Undo:

- restores the exact previous persisted version;
- does not call the recommendation engine;
- does not depend on candidate pools;
- returns a truthful success or failure summary.

---

## 12. Deterministic fallback

Fallback is not “show the hidden second candidate.”

Fallback should:

1. use the same context and validator;
2. select the highest-scoring legal deterministic candidate;
3. record why Sol was unavailable;
4. preserve required and targeted semantics;
5. return a truthful source marker.

If no legal candidate exists:

```ts
{
  success: false,
  code: "NO_LEGAL_OUTFIT",
  explanation: "...",
  recoverableActions: [...]
}
```

Never silently drop hard constraints to force an answer.

---

## 13. Explanation and traceability

A model-generated explanation can contradict the actual outfit. Generate explanations from `ScoreTrace`.

Example trace:

```json
{
  "contextFit": 0.88,
  "personalFit": 0.79,
  "structuredCompatibility": 0.84,
  "comfortPracticality": 0.93,
  "novelty": 0.62,
  "positives": [
    "Rain-safe shoes",
    "Matches relaxed tailoring anchor",
    "Comfortable for extended walking"
  ],
  "tradeoffs": [
    "Uses a recently worn neutral bag"
  ]
}
```

Then produce:

> “This keeps the look relaxed, works for walking, and stays rain-safe without feeling bulky.”

Validate that every factual phrase in the reason is supported by the selected items and context.

---

## 14. Operation consistency and concurrency

Recommendation correctness also depends on asynchronous state safety.

Introduce:

```ts
type OperationController = {
  operationId: number;
  abortController: AbortController | null;
  baseVersionId: string | null;
  mutating: boolean;
};
```

Every recommendation mutation should:

1. increment `operationId`;
2. capture `baseVersionId`;
3. cancel or invalidate the prior operation;
4. compute from the captured version;
5. before commit, verify:
   - operation is still current;
   - current version is still the captured base;
6. persist version, history, and session together;
7. only then publish the interactive UI state.

This must cover:

- targeted revision;
- global revision;
- random;
- undo;
- availability-triggered regeneration;
- confirm.

Initial recommendation already has sequence protection; all mutation paths need the same discipline.

---

## 15. Failure, security, and observability

### 15.1 Typed errors

Use stable codes:

```text
NO_LEGAL_OUTFIT
CONFLICTING_REQUIRED_ITEMS
TARGET_REPLACEMENT_UNAVAILABLE
STRUCTURE_TRANSITION_REQUIRED
INVALID_MODEL_OUTPUT
RANK_PROVIDER_FAILED
BOARD_TOO_LARGE
STALE_OPERATION
PERSISTENCE_FAILED
```

### 15.2 Diagnostics

Log only allowlisted metadata:

- request ID;
- operation ID;
- route;
- actual model name;
- source: live / mock / fallback;
- latency;
- candidate counts at each stage;
- rejection counts by constraint code;
- board bytes;
- token usage;
- typed error code.

Do not log:

- API keys;
- ephemeral tokens;
- audio;
- raw images;
- Data URLs;
- full personal utterances;
- full prompts.

### 15.3 Health endpoint

Expose non-secret configuration:

```json
{
  "aiMode": "live",
  "voiceMode": "mock",
  "itemModel": "gpt-5.6-terra",
  "rankModel": "gpt-5.6-sol",
  "realtimeModel": "gpt-realtime-2.1-mini",
  "realtimeVoice": "marin",
  "openaiConfigured": true,
  "photoroomConfigured": true,
  "scoringVersion": "v2"
}
```

### 15.4 Rate limiting

In-memory maps are insufficient on serverless infrastructure. For a public demo, use one or more of:

- Vercel platform firewall/rate limiting;
- distributed Redis/Upstash limit;
- signed app sessions;
- daily project cost ceiling;
- circuit breaker when provider errors or spend exceeds a threshold.

---

## 16. Evaluation strategy

### 16.1 Behavioral invariants

These tests are mandatory:

```text
Unavailable items are never selected.
Required items are always present.
Excluded IDs and categories never reappear.
Hard avoids survive Sol failure and fallback.
Rain-safe constraints survive every revision path.
Targeted revision preserves all non-target slots.
One-piece/separates transitions are atomic.
Random never immediately returns the current outfit.
Random avoids session repeats until candidates are exhausted.
Undo restores the exact previous version.
A stale operation cannot overwrite a newer version.
Model output cannot introduce unknown IDs.
Fallback remains legal.
Demo-to-personal mode does not leak demo garments.
```

### 16.2 Property-based tests

Generate synthetic wardrobes and intents.

Properties:

- every returned candidate passes `validateOutfit`;
- targeted revision changes at most the requested slot;
- required items remain present for all operations;
- excluded items remain absent for all operations;
- undo is the inverse of a successful mutation;
- candidate IDs are stable for the same ordered item set;
- no candidate contains duplicate IDs;
- deterministic output is reproducible under a fixed seed.

A property-testing library such as `fast-check` is appropriate for TypeScript.

### 16.3 Golden scenario set

Create a versioned set of realistic scenarios:

- rainy commute;
- hot outdoor day;
- cold indoor presentation;
- dinner after class;
- long walking day;
- required statement jacket;
- no heels;
- mixed wardrobe;
- small incomplete wardrobe;
- one-piece transition;
- multiple revisions with preserved shoes.

For each scenario, specify:

- legal constraints;
- expected preserved items;
- forbidden outcomes;
- human preference among candidate boards.

### 16.4 Human visual evaluation

For compatibility quality, use pairwise or listwise human judgment rather than only code metrics.

Questions:

1. Which outfit looks more coherent?
2. Which better matches the spoken request?
3. Which would you be more likely to wear?
4. Does the explanation match the outfit?
5. Is the recommendation decisive enough?

Compare:

- deterministic only;
- Sol only among legal candidates;
- blended score;
- alternative weighting versions.

### 16.5 Metrics

Hard correctness:

```text
hard_constraint_violation_rate = 0
targeted_preservation_rate = 1
undo_exact_restoration_rate = 1
unknown_item_id_rate = 0
```

Quality and system metrics:

- human preference win rate;
- request-alignment score;
- candidate coverage;
- session repetition rate;
- fallback rate;
- Sol invalid-output rate;
- p50/p95 recommendation latency;
- board compression failure rate;
- provider cost per completed outfit decision.

---

## 17. Implementation phases

### Phase 1 — correctness foundation

1. Create `RecommendationContext`.
2. Create canonical `validateOutfit()` and `validatePartial()`.
3. Compile hard rules.
4. Fix required items and accessory slots.
5. Route initial, targeted, global, random, and fallback through one pipeline.
6. Implement structured `IntentDelta`.
7. Implement atomic one-piece/separates transitions.
8. Add operation sequencing and transaction safety.
9. Add invariant and property tests.

Exit criteria:

```text
hard constraint violation = 0 in test corpus
targeted preservation = 100%
undo exact restoration = 100%
```

### Phase 2 — compatibility quality

1. Extend garment features.
2. Implement color, silhouette, material, formality, weather, and recency scoring.
3. Implement anchor-driven beam search.
4. Implement diversity filtering.
5. Expand Sol structured visual scoring.
6. Add `ScoreTrace`.
7. Build golden scenarios and human A/B evaluation.

### Phase 3 — real personalization

1. Bind calibration looks to semantic vectors.
2. Replace like-count logic with feature updates.
3. Implement multiple style anchors and cold-start shrinkage.
4. Use freeform preferences, metals, comfort bias, and formality bias in scoring.
5. Learn from confirmation and revisions without confusing context with permanent taste.
6. Add profile inspection and deletion support.

### Phase 4 — future research, not Build Week scope

Only after sufficient data:

- train or evaluate a dedicated outfit-set transformer;
- experiment with learned compatibility embeddings;
- use RecBole/Recommenders for offline comparisons;
- evaluate contextual bandits with logged propensities and offline policy evaluation;
- consider a separate optimization service if wardrobe and constraints outgrow TypeScript search.

---

## 18. Suggested code organization

```text
src/domain/recommendation/
  context.ts
  intent-delta.ts
  constraints/
    compile.ts
    validate-partial.ts
    validate-outfit.ts
    rules.ts
  search/
    anchors.ts
    templates.ts
    beam-search.ts
    diversity.ts
  scoring/
    weights.ts
    context-fit.ts
    personal-fit.ts
    color.ts
    silhouette.ts
    material.ts
    formality.ts
    practicality.ts
    novelty.ts
    score-candidate.ts
  revisions/
    targeted.ts
    global.ts
    random.ts
    structural-transition.ts
  explanations/
    score-trace.ts
    reason.ts
  engine.ts
```

Keep `engine.ts` as orchestration, not a file containing all scoring and mutation logic.

---

## 19. Recommended YiYi project skill

Create:

```text
.agents/skills/yiyi-recommendation-engine/SKILL.md
```

It should require Codex to preserve:

- the model/deterministic responsibility boundary;
- hard-constraint invariants;
- one-answer behavior;
- revision semantics;
- exact undo;
- unified context and validator;
- structured score trace;
- mandatory behavioral tests;
- no hidden second/third recommendation semantics.

This prevents future changes from reintroducing separate logic paths.

---

## 20. Anti-patterns

Do not:

- filter required items after shortlist;
- send hard avoids only as prompt text;
- maintain different legality rules for initial, revision, random, and fallback;
- interpret broad natural-language revisions with a few regexes;
- add independent item scores and call the result outfit compatibility;
- assign bags or accessories by array index;
- use hidden “second” and “third” outfits as undo;
- expose candidate pools to the user;
- let Sol invent item IDs;
- silently weaken constraints during fallback;
- convert every contextual rejection into permanent dislike;
- claim personalization while ignoring calibration semantics;
- claim randomization while alternating between two top results;
- update UI before the version/history transaction completes;
- treat passing a few happy-path E2E tests as recommendation validation.

---

## 21. Final architecture contract

The implementation is acceptable only if the following statement is true:

> Given the same wardrobe, context, profile, and structured intent, every initial recommendation, revision, random replacement, and fallback is produced by the same legality framework; every displayed outfit is legal; every user instruction is represented structurally; every mutation is version-safe; Sol only ranks legal visual candidates; the user sees one answer; undo restores exact history; and feedback updates personalization with explicit confidence and provenance.

---

## 22. References and what to learn from each

1. **Cucurull, Taslakian, Vazquez — Context-Aware Visual Compatibility Prediction, CVPR 2019**  
   Outfit compatibility depends on context, not isolated pairwise item similarity.  
   https://openaccess.thecvf.com/content_CVPR_2019/html/Cucurull_Context-Aware_Visual_Compatibility_Prediction_CVPR_2019_paper.html

2. **Sarkar et al. — OutfitTransformer, CVPR Workshops 2022**  
   Models outfits as unordered sets with self-attention; supports compatibility and complementary-item retrieval.  
   https://openaccess.thecvf.com/content/CVPR2022W/CVFAD/html/Sarkar_OutfitTransformer_Outfit_Representations_for_Fashion_Recommendation_CVPRW_2022_paper.html

3. **Lorbert et al. — Scalable and Explainable Outfit Generation, CVPR Workshops 2021**  
   Uses desired outfit compositions and beam search for scalable outfit generation.  
   https://openaccess.thecvf.com/content/CVPR2021W/CVFAD/html/Lorbert_Scalable_and_Explainable_Outfit_Generation_CVPRW_2021_paper.html

4. **Lu et al. — Personalized Outfit Recommendation With Learnable Anchors, CVPR 2021**  
   Multi-anchor personalization and cold-start handling with very limited user evidence.  
   https://openaccess.thecvf.com/content/CVPR2021/html/Lu_Personalized_Outfit_Recommendation_With_Learnable_Anchors_CVPR_2021_paper.html

5. **Jang, Hwang, Park — Text-to-Outfit Retrieval, WACV 2024**  
   Separates item-, style-, and outfit-level text semantics.  
   https://openaccess.thecvf.com/content/WACV2024/html/Jang_Lost_Your_Style_Navigating_With_Semantic-Level_Approach_for_Text-To-Outfit_Retrieval_WACV_2024_paper.html

6. **Zou et al. — How Good Is Aesthetic Ability of a Fashion Model?, CVPR 2022**  
   A100 evaluates detailed aesthetic dimensions such as color, balance, and material.  
   https://openaccess.thecvf.com/content/CVPR2022/html/Zou_How_Good_Is_Aesthetic_Ability_of_a_Fashion_Model_CVPR_2022_paper.html

7. **Lin, Tran, Davis — Fashion Outfit Complementary Item Retrieval, CVPR 2020**  
   Category-aware subspaces and outfit-level ranking for replacement retrieval.  
   https://openaccess.thecvf.com/content_CVPR_2020/html/Lin_Fashion_Outfit_Complementary_Item_Retrieval_CVPR_2020_paper.html

8. **Polyvore Dataset**  
   Useful historical compatibility/FITB benchmark; 21,889 outfits, but its age and platform bias limit direct production relevance. Apache-2.0 repository license.  
   https://github.com/xthan/polyvore-dataset

9. **RecList**  
   Behavioral black-box testing for recommender systems; useful as a testing philosophy for YiYi invariants.  
   https://github.com/RecList/reclist

10. **RecBole**  
    Broad recommendation research framework; useful later for offline experiments, not as YiYi’s current production core.  
    https://github.com/RUCAIBox/RecBole

11. **Recommenders**  
    Production-oriented recommendation examples and evaluation practices.  
    https://github.com/recommenders-team/recommenders

12. **Google OR-Tools CP-SAT**  
    Reference for constraint-programming discipline; not recommended as a current runtime dependency.  
    https://developers.google.com/optimization/cp/cp_solver

13. **Vowpal Wabbit contextual bandits**  
    Future option after sufficient logged feedback and safe offline evaluation.  
    https://vowpalwabbit.org/docs/vowpal_wabbit/python/latest/tutorials/python_Contextual_bandits_and_Vowpal_Wabbit.html

---

## 23. Codex reading instructions

Before changing the engine, Codex should:

1. read this document completely;
2. map every invariant to current code and tests;
3. identify which recommendations are immediate requirements versus future research;
4. inspect the installed OpenAI SDK types rather than relying on memory;
5. make the smallest coherent architectural refactor that unifies all recommendation paths;
6. add tests before claiming a bug is fixed;
7. run the full application flow and verify the actual selected item IDs and score traces—not merely that an outfit appeared.

---

## 24. YiYi v2 implementation decision record (2026-07-18)

The production implementation adopts the report’s constraint-first and anchor-driven direction, but does not copy its illustrative constants. YiYi’s current local wardrobes are small enough that a TypeScript template beam is easier to inspect and test than a solver or learned retrieval service. Beam width is dynamic (`18…48`), the legal pool is capped at 64, and six MMR-diverse boards reach Sol (the API contract remains bounded at eight). Six was selected after a production-board live comparison showed that always filling eight added material image/output cost and roughly sixteen seconds of provider latency. Required and preserved items are expanded first. Partial compatibility and bounded core-style groups protect complementary branches from single-item heuristic pruning; separates and one-piece remain separate templates.

Deterministic scoring owns 70% of a visually ranked result and Sol owns 30%. These are MVP calibration values, not learned truths: hard constraints are outside the weighted score and can never be rescued by Sol. Scoring weights are normalized per operation. Walking and comfort priorities change importance, while an outfit’s intrinsic walking/comfort performance stays stable; thermal scoring uses explicit body-coverage roles and ignores bags, jewelry, belts, eyewear, and hair accessories. The constant revision-compliance dimension was removed from active scoring. The trace records real search rejection counts plus candidate-specific visual evidence. Versioned golden scenarios and property tests are the calibration harness for changing weights or widths.

Multi-anchor personalization is implemented as a bounded, confidence-shrunk local representation derived from machine-readable calibration look semantics and repeated cross-context confirmations. Day-specific aesthetic terms are excluded from confirmation learning. Unstructured long-term voice or manual language is stored as an editable soft note; it cannot become a permanent hard rule without a safely compiled attribute scope. No collaborative filtering, contextual bandit, Python solver, external training service, or Polyvore model is introduced: present evidence volume cannot justify those systems. Day-specific structured deltas remain in `DailyIntent`.

Live Realtime uses the repository’s installed `@openai/agents` API (`RealtimeAgent`, `RealtimeSession`, WebRTC, `semantic_vad` with automatic eagerness and automatic interruption disabled). The application adds a product turn controller plus cancellation/generation guards around token acquisition and session replacement, while leaving transport and audio mechanics to the SDK.
