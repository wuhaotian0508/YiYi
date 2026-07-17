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
  }),
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

export const PreferenceRuleSchema = z.object({
  key: z.string().min(1).max(50),
  value: z.string().min(1).max(80),
  strength: z.enum(["hard", "soft"]),
});

export const PreferenceEvidenceSchema = z.object({
  phrase: z.string().min(1).max(200),
  source: z.enum(["onboarding", "explicit_voice", "repeated_feedback"]),
  createdAt: z.number(),
});

export const PreferenceProfileSchema = z.object({
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
  freeformSummary: z.string().max(300),
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
});

export const OutfitSchema = z.object({
  id: z.string().uuid(),
  itemIds: OutfitItemIdsSchema,
  deterministicScore: z.number(),
  reason: z.string().max(160).optional(),
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
  rankedCandidateIds: z.array(z.string().uuid()).length(3),
  mainReason: z.string().max(120),
  alternativeReasons: z.array(z.string().max(120)).length(2),
});

export const DailySessionSchema = z.object({
  id: z.string().uuid(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["draft", "active", "confirmed"]),
  intent: DailyIntentSchema,
  weather: WeatherContextSchema.nullable(),
  currentVersionId: z.string().uuid().nullable(),
  mainRecommendationId: z.string().uuid().nullable(),
  alternativeIds: z.array(z.string().uuid()).max(2),
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
export type DailyIntent = z.infer<typeof DailyIntentSchema>;
export type Outfit = z.infer<typeof OutfitSchema>;
export type OutfitItemIds = z.infer<typeof OutfitItemIdsSchema>;
export type OutfitVersion = z.infer<typeof OutfitVersionSchema>;
export type WeatherContext = z.infer<typeof WeatherContextSchema>;
export type DailySession = z.infer<typeof DailySessionSchema>;
