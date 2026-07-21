import { z } from "zod";
import { StyleVectorSchema, type StyleVector } from "@/domain/schemas";

const StyleAxisSchema = z.enum([
  "relaxedPolished",
  "minimalExpressive",
  "softCool",
  "fittedOversized",
  "classicTrendAware",
  "feminineNeutral",
]);

const CalibrationOptionSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  vector: StyleVectorSchema,
  styleTags: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
}).strict();

const CalibrationAssetSchema = z.object({
  src: z.string().regex(/^\/style-calibration\/(?:v2|v3\/(?:womenswear|neutral))\/.+\.webp$/),
  width: z.literal(1254),
  height: z.literal(1254),
  layout: z.literal("split_left_right"),
}).strict();

const CalibrationQuestionSchema = z.object({
  id: z.string().min(1).max(80),
  prompt: z.string().min(1).max(120),
  primaryAxis: StyleAxisSchema,
  // `asset` remains the v2 menswear-compatible path for stored catalog-v2
  // provenance. Runtime presentation chooses one of the canonical visual
  // tracks without changing question IDs, options, or style vectors.
  asset: CalibrationAssetSchema,
  directionAssets: z.object({
    womenswear: CalibrationAssetSchema,
    menswear: CalibrationAssetSchema,
    neutral: CalibrationAssetSchema,
  }).strict(),
  optionA: CalibrationOptionSchema,
  optionB: CalibrationOptionSchema,
}).strict();

export const CalibrationCatalogSchema = z.object({
  id: z.literal("yiyi-style-calibration"),
  version: z.literal(2),
  method: z.literal("pairwise_with_absolute_escape_hatches"),
  responseChoices: z.tuple([
    z.literal("a"),
    z.literal("b"),
    z.literal("both"),
    z.literal("neither"),
    z.literal("skip"),
  ]),
  presentation: z.object({
    subject: z.literal("headless_mannequin"),
    background: z.literal("controlled_neutral"),
    framing: z.literal("full_outfit"),
    intendedQuestion: z.literal("would_wear"),
  }).strict(),
  questions: z.array(CalibrationQuestionSchema).length(6),
}).strict();

export type CalibrationCatalog = z.infer<typeof CalibrationCatalogSchema>;
export type CalibrationQuestion = CalibrationCatalog["questions"][number];
export type CalibrationOption = CalibrationQuestion["optionA"];
export type StyleAxis = z.infer<typeof StyleAxisSchema>;
export type CalibrationAsset = CalibrationQuestion["asset"];

const zero: StyleVector = {
  relaxedPolished: 0,
  minimalExpressive: 0,
  softCool: 0,
  fittedOversized: 0,
  classicTrendAware: 0,
  feminineNeutral: 0,
};

function directionAssets(filename: string) {
  const asset = (src: string): CalibrationAsset => ({ src, width: 1254, height: 1254, layout: "split_left_right" });
  return {
    womenswear: asset(`/style-calibration/v3/womenswear/${filename}`),
    menswear: asset(`/style-calibration/v2/${filename}`),
    neutral: asset(`/style-calibration/v3/neutral/${filename}`),
  };
}

export function calibrationAssetForDirection(
  question: CalibrationQuestion,
  direction: "womenswear" | "menswear" | "mixed" | "neutral",
  questionIndex: number,
) {
  if (direction === "mixed") {
    // Deterministic alternation prevents refresh/back navigation from changing
    // a comparison while keeping the track balanced over the six questions.
    return questionIndex % 2 === 0 ? question.directionAssets.womenswear : question.directionAssets.menswear;
  }
  return question.directionAssets[direction];
}

/**
 * Version 2 deliberately measures outfits rather than model or photography
 * appeal: every board uses the same headless mannequin, neutral backdrop,
 * square framing, scale, and full-outfit crop. Wardrobe direction remains a
 * separate, inclusive question; these looks do not infer gender identity.
 */
export const calibrationCatalogV2: CalibrationCatalog = CalibrationCatalogSchema.parse({
  id: "yiyi-style-calibration",
  version: 2,
  method: "pairwise_with_absolute_escape_hatches",
  responseChoices: ["a", "b", "both", "neither", "skip"],
  presentation: {
    subject: "headless_mannequin",
    background: "controlled_neutral",
    framing: "full_outfit",
    intendedQuestion: "would_wear",
  },
  questions: [
    {
      id: "relaxed-or-polished",
      prompt: "Which feels more like something you would actually wear?",
      primaryAxis: "relaxedPolished",
      asset: { src: "/style-calibration/v2/pair-relaxed-polished.webp", width: 1254, height: 1254, layout: "split_left_right" },
      directionAssets: directionAssets("pair-relaxed-polished.webp"),
      optionA: {
        id: "relaxed-everyday",
        label: "Relaxed everyday",
        vector: { ...zero, relaxedPolished: -0.82, minimalExpressive: -0.28, softCool: -0.18, fittedOversized: 0.3 },
        styleTags: ["relaxed", "casual", "soft", "easy"],
      },
      optionB: {
        id: "polished-tailoring",
        label: "Polished tailoring",
        vector: { ...zero, relaxedPolished: 0.88, minimalExpressive: -0.32, softCool: 0.28, fittedOversized: -0.08 },
        styleTags: ["polished", "tailored", "structured", "refined"],
      },
    },
    {
      id: "minimal-or-expressive",
      prompt: "Which feels more like something you would actually wear?",
      primaryAxis: "minimalExpressive",
      asset: { src: "/style-calibration/v2/pair-minimal-expressive.webp", width: 1254, height: 1254, layout: "split_left_right" },
      directionAssets: directionAssets("pair-minimal-expressive.webp"),
      optionA: {
        id: "minimal-monochrome",
        label: "Minimal monochrome",
        vector: { ...zero, relaxedPolished: 0.18, minimalExpressive: -0.9, softCool: 0.18, classicTrendAware: -0.14 },
        styleTags: ["minimal", "monochrome", "clean", "understated"],
      },
      optionB: {
        id: "expressive-color",
        label: "Expressive color",
        vector: { ...zero, relaxedPolished: -0.1, minimalExpressive: 0.9, softCool: 0.16, classicTrendAware: 0.32 },
        styleTags: ["expressive", "colorful", "playful", "color-blocked"],
      },
    },
    {
      id: "soft-or-utility",
      prompt: "Which feels more like something you would actually wear?",
      primaryAxis: "softCool",
      asset: { src: "/style-calibration/v2/pair-soft-utility.webp", width: 1254, height: 1254, layout: "split_left_right" },
      directionAssets: directionAssets("pair-soft-utility.webp"),
      optionA: {
        id: "soft-fluid-layers",
        label: "Soft fluid layers",
        vector: { ...zero, relaxedPolished: -0.3, minimalExpressive: -0.28, softCool: -0.86, fittedOversized: 0.34 },
        styleTags: ["soft", "fluid", "cozy", "tonal"],
      },
      optionB: {
        id: "utility-layers",
        label: "Practical utility",
        vector: { ...zero, relaxedPolished: -0.3, minimalExpressive: 0.12, softCool: 0.82, fittedOversized: 0.2, classicTrendAware: 0.2 },
        styleTags: ["utility", "rugged", "practical", "structured"],
      },
    },
    {
      id: "fitted-or-oversized",
      prompt: "Which silhouette feels more like you?",
      primaryAxis: "fittedOversized",
      asset: { src: "/style-calibration/v2/pair-fitted-oversized.webp", width: 1254, height: 1254, layout: "split_left_right" },
      directionAssets: directionAssets("pair-fitted-oversized.webp"),
      optionA: {
        id: "fitted-streamlined",
        label: "Fitted and streamlined",
        vector: { ...zero, relaxedPolished: 0.32, minimalExpressive: -0.24, fittedOversized: -0.9 },
        styleTags: ["fitted", "streamlined", "clean", "defined"],
      },
      optionB: {
        id: "oversized-volume",
        label: "Oversized volume",
        vector: { ...zero, relaxedPolished: -0.38, minimalExpressive: -0.08, fittedOversized: 0.92, classicTrendAware: 0.25 },
        styleTags: ["oversized", "relaxed", "voluminous", "modern"],
      },
    },
    {
      id: "classic-or-trend-aware",
      prompt: "Which feels more like something you would actually wear?",
      primaryAxis: "classicTrendAware",
      asset: { src: "/style-calibration/v2/pair-classic-trend.webp", width: 1254, height: 1254, layout: "split_left_right" },
      directionAssets: directionAssets("pair-classic-trend.webp"),
      optionA: {
        id: "classic-layering",
        label: "Classic layering",
        vector: { ...zero, relaxedPolished: 0.28, minimalExpressive: -0.24, fittedOversized: -0.08, classicTrendAware: -0.9 },
        styleTags: ["classic", "timeless", "preppy", "layered"],
      },
      optionB: {
        id: "trend-aware-proportions",
        label: "Trend-aware proportions",
        vector: { ...zero, relaxedPolished: -0.1, minimalExpressive: 0.18, fittedOversized: 0.58, classicTrendAware: 0.9 },
        styleTags: ["trend-aware", "cropped", "sculptural", "contemporary"],
      },
    },
    {
      id: "tonal-or-graphic",
      prompt: "Which surface treatment feels more like you?",
      primaryAxis: "minimalExpressive",
      asset: { src: "/style-calibration/v2/pair-tonal-graphic.webp", width: 1254, height: 1254, layout: "split_left_right" },
      directionAssets: directionAssets("pair-tonal-graphic.webp"),
      optionA: {
        id: "quiet-tonal",
        label: "Quiet tonal",
        vector: { ...zero, relaxedPolished: 0.08, minimalExpressive: -0.68, softCool: -0.12, classicTrendAware: -0.18 },
        styleTags: ["tonal", "quiet", "understated", "clean"],
      },
      optionB: {
        id: "bold-graphic",
        label: "Bold graphic",
        vector: { ...zero, relaxedPolished: -0.08, minimalExpressive: 0.72, softCool: 0.22, classicTrendAware: 0.26 },
        styleTags: ["graphic", "patterned", "bold", "contrast"],
      },
    },
  ],
});

export function getCalibrationQuestion(questionId: string, catalog: CalibrationCatalog = calibrationCatalogV2) {
  return catalog.questions.find((question) => question.id === questionId);
}
