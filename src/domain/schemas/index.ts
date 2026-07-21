import { z } from "zod";
import { clothingCategories, colorIds } from "@/domain/taxonomy";

export const ClothingCategorySchema = z.enum(clothingCategories);
export const ColorIdSchema = z.enum(colorIds);
export const PatternSchema = z.enum(["solid", "striped", "checked", "floral", "graphic", "textured", "animal", "other", "unknown"]);
export const FitSchema = z.enum(["slim", "regular", "relaxed", "oversized", "cropped", "longline", "other", "unknown"]);
export const AvailabilitySchema = z.enum(["available", "laundry", "unavailable"]);
export const MetalSchema = z.enum(["gold", "silver", "mixed", "none", "unknown"]);

const normalizedTag = z.string().trim().min(1).max(40).transform((value) => value.toLowerCase());
const normalizedTags = z.array(normalizedTag).max(12).transform((values) => [...new Set(values)]);

export const WardrobeItemSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(1),
  category: ClothingCategorySchema,
  subtype: z.string().min(1).max(40),
  primaryColor: ColorIdSchema,
  secondaryColors: z.array(ColorIdSchema).max(2),
  materials: z.array(z.string().trim().min(1).max(40)).max(4),
  pattern: PatternSchema,
  fit: FitSchema,
  warmth: z.number().int().min(1).max(5),
  formality: z.number().int().min(1).max(5),
  comfort: z.number().int().min(1).max(5),
  styleTags: normalizedTags,
  occasionTags: normalizedTags,
  weatherTags: normalizedTags,
  metal: MetalSchema.optional(),
  availability: AvailabilitySchema,
  unavailableReason: z.string().max(120).optional(),
  aiConfidence: z.object({
    category: z.number().min(0).max(1),
    colors: z.number().min(0).max(1),
    materials: z.number().min(0).max(1),
    pattern: z.number().min(0).max(1),
    fit: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    formality: z.number().min(0).max(1).optional(),
    warmth: z.number().min(0).max(1).optional(),
    comfort: z.number().min(0).max(1).optional(),
  }),
  featureProvenance: z.record(z.string(), z.enum(["terra", "user", "derived", "demo"])).optional(),
  dataProvenance: z.enum(["demo", "personal"]).optional(),
  internalDescription: z.string().max(240),
  userEditedFields: z.array(z.string()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastWornAt: z.number().nullable(),
});

export const WardrobeAnalysisSchema = WardrobeItemSchema.omit({
  id: true,
  schemaVersion: true,
  availability: true,
  createdAt: true,
  updatedAt: true,
  lastWornAt: true,
});

// OpenAI Structured Outputs cannot compile Zod transforms/defaults into JSON
// Schema. Keep this provider-facing contract plain and required, then validate
// its output through WardrobeAnalysisSchema before it enters domain state.
const ProviderFeatureSourceSchema = z.enum(["terra", "user", "derived", "demo"]);
export const WardrobeAnalysisProviderSchema = z.object({
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
  styleTags: z.array(z.string().min(1).max(40)).max(12),
  occasionTags: z.array(z.string().min(1).max(40)).max(12),
  weatherTags: z.array(z.string().min(1).max(40)).max(12),
  metal: MetalSchema,
  aiConfidence: z.object({
    category: z.number().min(0).max(1),
    colors: z.number().min(0).max(1),
    materials: z.number().min(0).max(1),
    pattern: z.number().min(0).max(1),
    fit: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    formality: z.number().min(0).max(1),
    warmth: z.number().min(0).max(1),
    comfort: z.number().min(0).max(1),
  }),
  featureProvenance: z.object({
    category: ProviderFeatureSourceSchema,
    colors: ProviderFeatureSourceSchema,
    materials: ProviderFeatureSourceSchema,
    pattern: ProviderFeatureSourceSchema,
    fit: ProviderFeatureSourceSchema,
    style: ProviderFeatureSourceSchema,
    formality: ProviderFeatureSourceSchema,
    warmth: ProviderFeatureSourceSchema,
    comfort: ProviderFeatureSourceSchema,
  }),
  internalDescription: z.string().max(240),
});

export const ItemImageSetSchema = z.object({
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

export const StyleVectorSchema = z.object({
  relaxedPolished: z.number().min(-1).max(1),
  minimalExpressive: z.number().min(-1).max(1),
  softCool: z.number().min(-1).max(1),
  fittedOversized: z.number().min(-1).max(1),
  classicTrendAware: z.number().min(-1).max(1),
  feminineNeutral: z.number().min(-1).max(1),
});

export const WardrobeDirectionSchema = z.enum(["womenswear", "menswear", "mixed", "neutral"]);

export const StyleFeedbackSchema = z.object({
  lookId: z.string().min(1).max(40),
  sentiment: z.enum(["like", "dislike", "skip"]),
}).strict();

export const CalibrationResponseChoiceSchema = z.enum(["a", "b", "both", "neither", "skip"]);
export const CalibrationPresentationOrderSchema = z.union([
  z.tuple([z.literal("a"), z.literal("b")]),
  z.tuple([z.literal("b"), z.literal("a")]),
]);

export const CalibrationResponseSchema = z.object({
  id: z.string().min(1).max(160),
  catalogId: z.string().min(1).max(80),
  catalogVersion: z.number().int().positive(),
  questionId: z.string().min(1).max(80),
  choice: CalibrationResponseChoiceSchema,
  // Optional on read for responses created before counterbalanced presentation.
  // Every new response writes the actual left-to-right order shown to the user.
  presentationOrder: CalibrationPresentationOrderSchema.optional(),
  createdAt: z.number(),
}).strict();

export const PreferenceSignalSchema = z.object({
  id: z.string().min(1).max(200),
  attribute: z.enum(["style_look", "style", "fit", "color", "material", "category", "subtype", "metal", "comfort", "formality", "combination", "preference_note"]),
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  polarity: z.enum(["more", "less", "unknown"]),
  strength: z.enum(["soft", "hard"]),
  confidence: z.number().min(0).max(1),
  scope: z.enum(["global_style", "relative_pair", "category", "contextual"]),
  categories: z.array(ClothingCategorySchema).max(clothingCategories.length).default([]),
  slots: z.array(z.enum(["top", "bottom", "onePiece", "outerwear", "shoes", "bag", "jewelry", "extraAccessory"])).max(8).default([]),
  permanence: z.enum(["onboarding_seed", "long_term", "contextual"]),
  editable: z.boolean(),
  status: z.enum(["active", "needs_review", "deleted"]).default("active"),
  combinationValues: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
  semanticVector: StyleVectorSchema.optional(),
  styleTags: normalizedTags.default([]),
  provenance: z.object({
    source: z.enum(["calibration_pairwise", "explicit_edit", "profile_edit", "explicit_voice", "migration", "confirmation", "contextual_revision"]),
    sourceId: z.string().min(1).max(160).optional(),
    catalogId: z.string().min(1).max(80).optional(),
    catalogVersion: z.number().int().positive().optional(),
    questionId: z.string().min(1).max(80).optional(),
    optionId: z.string().min(1).max(80).optional(),
    responseChoice: CalibrationResponseChoiceSchema.optional(),
    presentationOrder: CalibrationPresentationOrderSchema.optional(),
    createdAt: z.number(),
  }).strict(),
}).strict().superRefine((signal, context) => {
  if (signal.polarity === "unknown" && signal.confidence !== 0) {
    context.addIssue({ code: "custom", message: "Unknown preference signals cannot influence confidence or scoring." });
  }
  if (signal.provenance.source === "calibration_pairwise") {
    const complete = signal.provenance.catalogId
      && signal.provenance.catalogVersion
      && signal.provenance.questionId
      && signal.provenance.optionId
      && signal.provenance.responseChoice;
    if (!complete || !signal.semanticVector || signal.permanence !== "onboarding_seed") {
      context.addIssue({ code: "custom", message: "Pairwise calibration signals require complete catalog provenance and onboarding semantics." });
    }
  }
  if (signal.strength === "hard" && signal.polarity !== "less") {
    context.addIssue({ code: "custom", message: "Only explicit negative preferences may become hard profile rules." });
  }
  if (signal.attribute === "combination" && signal.combinationValues.length < 2) {
    context.addIssue({ code: "custom", message: "Combination preferences require at least two atomic values." });
  }
  if (signal.attribute === "combination" && new Set(signal.combinationValues.map((value) => value.trim().toLocaleLowerCase("en-US"))).size < 2) {
    context.addIssue({ code: "custom", message: "Combination preferences require two distinct atomic values." });
  }
  if (signal.attribute === "preference_note" && signal.status === "active") {
    context.addIssue({ code: "custom", message: "Unstructured preference notes must remain reviewable until they are safely structured." });
  }
});

export const PreferenceDeltaSchema = z.object({
  action: z.enum(["add", "remove"]),
  signalId: z.string().min(1).max(200).nullable(),
  attribute: z.enum(["style", "fit", "color", "material", "category", "subtype", "metal", "comfort", "formality", "combination", "preference_note"]).nullable(),
  value: z.string().trim().min(1).max(80).nullable(),
  label: z.string().trim().min(1).max(80).nullable(),
  polarity: z.enum(["more", "less"]).nullable(),
  strength: z.enum(["soft", "hard"]),
  scope: z.enum(["global_style", "category"]),
  categories: z.array(ClothingCategorySchema).max(clothingCategories.length),
  slots: z.array(z.enum(["top", "bottom", "onePiece", "outerwear", "shoes", "bag", "jewelry", "extraAccessory"])).max(8),
  combinationValues: z.array(z.string().trim().min(1).max(40)).max(6),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  evidenceSummary: z.string().trim().min(1).max(160).nullable(),
}).strict().superRefine((delta, context) => {
  if (delta.action === "remove" && !delta.signalId) context.addIssue({ code: "custom", message: "Removing a preference requires signalId." });
  if (delta.action === "add" && (!delta.attribute || !delta.value || !delta.label || !delta.polarity)) context.addIssue({ code: "custom", message: "Adding a preference requires a structured target, label, and polarity." });
  if (delta.strength === "hard" && delta.polarity !== "less") context.addIssue({ code: "custom", message: "Hard positive preferences are not supported." });
  if (delta.attribute === "combination" && delta.combinationValues.length < 2) context.addIssue({ code: "custom", message: "Combination preferences require at least two values." });
  if (delta.attribute === "combination" && new Set(delta.combinationValues.map((value) => value.trim().toLocaleLowerCase("en-US"))).size < 2) context.addIssue({ code: "custom", message: "Combination preferences require two distinct values." });
  if (delta.attribute === "preference_note" && !delta.needsReview) context.addIssue({ code: "custom", message: "Unstructured preference notes require review before they can influence recommendations." });
});

export const ProfileConfidenceSchema = z.object({
  evidence: z.number().min(0).max(1),
  coverage: z.number().min(0).max(1),
  differentiation: z.number().min(0).max(1),
  overall: z.number().min(0).max(1),
}).strict();

export const StyleAnchorSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(60),
  vector: StyleVectorSchema,
  styleTags: z.record(z.string(), z.number().min(-1).max(1)),
  evidenceCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  updatedAt: z.number(),
}).strict();

export const PreferenceRuleSchema = z.object({
  key: z.string().min(1).max(50),
  value: z.string().min(1).max(80),
  strength: z.enum(["hard", "soft"]),
  polarity: z.enum(["prefer", "avoid"]).optional(),
}).superRefine((rule, context) => {
  if (rule.strength === "hard" && rule.polarity === "prefer") {
    context.addIssue({ code: "custom", message: "Hard positive requirements must use requiredItemIds." });
  }
});

export const PreferenceEvidenceSchema = z.object({
  phrase: z.string().min(1).max(200),
  source: z.enum(["onboarding", "explicit_edit", "profile_edit", "explicit_voice", "repeated_feedback", "confirmation", "contextual_revision"]),
  createdAt: z.number(),
});

export const PreferenceProfileSchema = z.object({
  id: z.literal("default"),
  // Optional on read so profiles written before the pairwise calibration model
  // remain valid. New calibration writes always materialize these fields.
  schemaVersion: z.literal(2).optional(),
  origin: z.enum(["neutral", "calibration", "demo", "migrated", "edited", "learned"]).optional(),
  revision: z.number().int().nonnegative().optional(),
  wardrobeDirection: WardrobeDirectionSchema.default("neutral"),
  styleVector: StyleVectorSchema,
  styleFeedback: z.array(StyleFeedbackSchema).max(24).default([]),
  calibrationResponses: z.array(CalibrationResponseSchema).max(24).optional(),
  preferenceSignals: z.array(PreferenceSignalSchema).max(100).optional(),
  profileConfidence: ProfileConfidenceSchema.optional(),
  styleAnchors: z.array(StyleAnchorSchema).max(4).default([]),
  hardAvoids: z.array(PreferenceRuleSchema),
  softPreferences: z.array(PreferenceRuleSchema),
  preferenceNotes: z.object({
    moreOf: z.array(z.string().trim().min(1).max(80)).max(12),
    lessOf: z.array(z.string().trim().min(1).max(80)).max(12),
    freeform: z.string().max(400),
  }).strict().default({ moreOf: [], lessOf: [], freeform: "" }),
  preferredMetals: z.array(z.enum(["gold", "silver", "mixed"])),
  comfortWeight: z.number().min(0).max(1),
  formalityBias: z.number().min(-1).max(1),
  evidence: z.array(PreferenceEvidenceSchema).max(100),
  provenance: z.enum(["demo", "personal"]).default("personal"),
  updatedAt: z.number(),
});

export const OutfitSlotSchema = z.enum(["top", "bottom", "onePiece", "outerwear", "shoes", "bag", "jewelry", "extraAccessory"]);
export const RecommendationOperationSchema = z.enum(["initial", "targeted_revision", "global_revision", "random_new_outfit", "fallback"]);
export const IntentItemRuleSchema = z.object({
  key: z.enum(["category", "color", "material", "fit", "style", "subtype", "metal"]),
  value: normalizedTag,
  polarity: z.enum(["prefer", "avoid"]),
  strength: z.enum(["hard", "soft"]),
  categories: z.array(ClothingCategorySchema).max(clothingCategories.length),
  slots: z.array(OutfitSlotSchema).max(8),
}).strict();

export const DailyIntentSchema = z.object({
  activities: z.array(z.object({
    label: z.string().min(1).max(60),
    timeOfDay: z.enum(["morning", "afternoon", "evening", "all_day", "unknown"]),
  }).strict()).max(8),
  aestheticTerms: z.array(z.string().min(1).max(50)).max(10),
  desiredFormality: z.number().int().min(1).max(5).optional(),
  comfortPriority: z.number().int().min(1).max(5).default(3),
  photoPriority: z.number().int().min(1).max(5).default(3),
  walkingIntensity: z.number().int().min(1).max(5).default(2),
  excludedCategories: z.array(ClothingCategorySchema),
  excludedItemIds: z.array(z.string().uuid()),
  requiredItemIds: z.array(z.string().uuid()),
  temporaryPreferences: z.array(PreferenceRuleSchema),
  temporaryItemRules: z.array(IntentItemRuleSchema).max(24).optional(),
  freeformSummary: z.string().max(300),
  warmthBias: z.number().min(-1).max(1).optional(),
  colorfulnessBias: z.number().min(-1).max(1).optional(),
  layeringBias: z.number().min(-1).max(1).optional(),
  structureBias: z.number().min(-1).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  ambiguity: z.array(z.string().min(1).max(120)).max(6).optional(),
}).strict();

export const IntentDeltaSchema = z.object({
  operation: z.enum(["targeted_revision", "global_revision", "random_new_outfit", "undo", "confirm"]),
  targetSlots: z.array(OutfitSlotSchema).max(3),
  preserveSlots: z.array(OutfitSlotSchema).max(8),
  emptySlots: z.array(OutfitSlotSchema).max(4).optional(),
  requiredItemIds: z.array(z.string().uuid()).max(12),
  excludedItemIds: z.array(z.string().uuid()).max(24),
  excludedCategories: z.array(ClothingCategorySchema).max(clothingCategories.length),
  adjustments: z.object({
    formality: z.number().min(-1).max(1).default(0),
    warmth: z.number().min(-1).max(1).default(0),
    comfort: z.number().min(-1).max(1).default(0),
    colorfulness: z.number().min(-1).max(1).default(0),
    walkingPriority: z.number().min(-1).max(1).default(0),
    layering: z.number().min(-1).max(1).default(0),
    structure: z.number().min(-1).max(1).default(0),
  }).strict(),
  desiredStyleTags: normalizedTags,
  undesiredStyleTags: normalizedTags,
  temporaryRules: z.array(IntentItemRuleSchema).max(12).default([]),
  rawUtterance: z.string().min(1).max(300),
  confidence: z.number().min(0).max(1),
  ambiguity: z.array(z.string().min(1).max(120)).max(6),
}).strict();

export const OutfitItemIdsSchema = z.object({
  top: z.string().uuid().optional(),
  bottom: z.string().uuid().optional(),
  onePiece: z.string().uuid().optional(),
  outerwear: z.string().uuid().optional(),
  shoes: z.string().uuid(),
  bag: z.string().uuid().optional(),
  jewelry: z.string().uuid().optional(),
  extraAccessory: z.string().uuid().optional(),
}).superRefine((ids, context) => {
  const separates = Boolean(ids.top && ids.bottom && !ids.onePiece);
  const onePiece = Boolean(ids.onePiece && !ids.top && !ids.bottom);
  if (!separates && !onePiece) context.addIssue({ code: "custom", message: "Outfit needs top + bottom or one piece" });
  const values = Object.values(ids).filter((id): id is string => Boolean(id));
  if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: "An item cannot occupy more than one slot" });
});

export const ScoreTraceSchema = z.object({
  dimensions: z.object({
    contextFit: z.number().min(0).max(1),
    personalFit: z.number().min(0).max(1),
    structuredCompatibility: z.number().min(0).max(1),
    comfortPracticality: z.number().min(0).max(1),
    novelty: z.number().min(0).max(1),
    revisionCompliance: z.number().min(0).max(1).optional(),
    visualScore: z.number().min(0).max(1).optional(),
  }).strict(),
  weights: z.record(z.string(), z.number().min(0).max(1)),
  hardConstraintChecks: z.array(z.object({ rule: z.string(), passed: z.boolean(), itemIds: z.array(z.string().uuid()).optional() }).strict()),
  positives: z.array(z.string().max(100)).max(8),
  tradeoffs: z.array(z.string().max(100)).max(8),
  warnings: z.array(z.string().max(100)).max(8),
  visualEvidence: z.object({
    reason: z.string().max(120),
    concerns: z.array(z.string().max(100)).max(4),
  }).strict().optional(),
  searchDiagnostics: z.object({
    expandedPartialCount: z.number().int().nonnegative(),
    finalLegalCount: z.number().int().nonnegative(),
    rejectionCounts: z.record(z.string(), z.number().int().nonnegative()),
  }).strict().optional(),
  deterministicTotal: z.number().min(0).max(1),
  finalTotal: z.number().min(0).max(1).optional(),
  scoringVersion: z.string().min(1).max(30),
}).strict();

export const OutfitSchema = z.object({
  id: z.string().uuid(),
  itemIds: OutfitItemIdsSchema,
  deterministicScore: z.number(),
  reason: z.string().max(160).optional(),
  scoreTrace: ScoreTraceSchema.optional(),
  source: z.enum(["deterministic", "visual", "fallback"]).optional(),
});

export const OutfitVersionSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  parentVersionId: z.string().uuid().nullable(),
  outfit: OutfitSchema,
  revisionRequest: z.string().max(300).nullable(),
  changedItemIds: z.array(z.string().uuid()),
  preservedItemIds: z.array(z.string().uuid()),
  createdAt: z.number(),
});

export const WeatherContextSchema = z.object({
  minApparentTempC: z.number(),
  maxApparentTempC: z.number(),
  precipitationProbability: z.number().min(0).max(100),
  expectedRain: z.boolean(),
  windy: z.boolean(),
  summary: z.string().max(80),
  sourceTimestamp: z.number(),
});

export const OutfitRankingResultSchema = z.object({
  selectedCandidateId: z.string().uuid(),
  mainReason: z.string().max(120),
  candidateScores: z.array(z.object({
    candidateId: z.string().uuid(),
    visualCoherence: z.number().min(0).max(1),
    colorBalance: z.number().min(0).max(1),
    silhouetteBalance: z.number().min(0).max(1),
    materialHarmony: z.number().min(0).max(1),
    styleClarity: z.number().min(0).max(1),
    reason: z.string().max(120),
    concerns: z.array(z.string().max(100)).max(4),
  }).strict()).max(8).default([]),
}).strict();

export const DailySessionSchema = z.object({
  id: z.string().uuid(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["draft", "active", "confirmed"]),
  intent: DailyIntentSchema,
  weather: WeatherContextSchema.nullable(),
  currentVersionId: z.string().uuid().nullable(),
  mainRecommendationId: z.string().uuid().nullable(),
  alternativeIds: z.array(z.string().uuid()).max(2).default([]),
  historyVersionIds: z.array(z.string().uuid()).max(50).default([]),
  shownOutfitIds: z.array(z.string().uuid()).max(100).default([]),
  operationGeneration: z.number().int().nonnegative().default(0),
  createdAt: z.number(),
  updatedAt: z.number(),
  confirmedAt: z.number().nullable(),
});

export const ApiErrorSchema = z.object({
  requestId: z.string().uuid(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }),
});

export type WardrobeItem = z.infer<typeof WardrobeItemSchema>;
export type WardrobeAnalysis = z.infer<typeof WardrobeAnalysisSchema>;
export type ItemImageSet = z.infer<typeof ItemImageSetSchema>;
export type PreferenceProfile = z.infer<typeof PreferenceProfileSchema>;
export type StyleVector = z.infer<typeof StyleVectorSchema>;
export type WardrobeDirection = z.infer<typeof WardrobeDirectionSchema>;
export type StyleFeedback = z.infer<typeof StyleFeedbackSchema>;
export type CalibrationResponseChoice = z.infer<typeof CalibrationResponseChoiceSchema>;
export type CalibrationPresentationOrder = z.infer<typeof CalibrationPresentationOrderSchema>;
export type CalibrationResponse = z.infer<typeof CalibrationResponseSchema>;
export type PreferenceSignal = z.infer<typeof PreferenceSignalSchema>;
export type PreferenceDelta = z.infer<typeof PreferenceDeltaSchema>;
export type ProfileConfidence = z.infer<typeof ProfileConfidenceSchema>;
export type StyleAnchor = z.infer<typeof StyleAnchorSchema>;
export type DailyIntent = z.infer<typeof DailyIntentSchema>;
export type IntentDelta = z.infer<typeof IntentDeltaSchema>;
export type IntentItemRule = z.infer<typeof IntentItemRuleSchema>;
export type Outfit = z.infer<typeof OutfitSchema>;
export type OutfitItemIds = z.infer<typeof OutfitItemIdsSchema>;
export type OutfitSlot = z.infer<typeof OutfitSlotSchema>;
export type RecommendationOperation = z.infer<typeof RecommendationOperationSchema>;
export type ScoreTrace = z.infer<typeof ScoreTraceSchema>;
export type OutfitVersion = z.infer<typeof OutfitVersionSchema>;
export type WeatherContext = z.infer<typeof WeatherContextSchema>;
export type DailySession = z.infer<typeof DailySessionSchema>;
