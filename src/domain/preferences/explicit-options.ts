import { PreferenceDeltaSchema, type PreferenceDelta } from "@/domain/schemas";

export type ExplicitPreferenceOption = {
  id: string;
  label: string;
  polarity: "more" | "less";
  delta: Omit<PreferenceDelta, "action" | "signalId" | "label" | "polarity" | "strength" | "confidence" | "needsReview" | "evidenceSummary">;
};

export const morePreferenceOptions: ExplicitPreferenceOption[] = [
  { id: "more-relaxed", label: "Relaxed tailoring", polarity: "more", delta: { attribute: "style", value: "relaxed", scope: "global_style", categories: [], slots: [], combinationValues: [] } },
  { id: "more-clean", label: "Clean layers", polarity: "more", delta: { attribute: "style", value: "clean", scope: "global_style", categories: [], slots: [], combinationValues: [] } },
  { id: "more-sporty", label: "Sporty pieces", polarity: "more", delta: { attribute: "style", value: "sporty", scope: "global_style", categories: [], slots: [], combinationValues: [] } },
  { id: "more-soft", label: "Soft textures", polarity: "more", delta: { attribute: "style", value: "soft", scope: "global_style", categories: [], slots: [], combinationValues: [] } },
  { id: "more-color", label: "Color", polarity: "more", delta: { attribute: "color", value: "chromatic", scope: "global_style", categories: [], slots: [], combinationValues: [] } },
  { id: "more-minimal", label: "Minimal looks", polarity: "more", delta: { attribute: "style", value: "minimal", scope: "global_style", categories: [], slots: [], combinationValues: [] } },
];

export const lessPreferenceOptions: ExplicitPreferenceOption[] = [
  { id: "less-heels", label: "Heels", polarity: "less", delta: { attribute: "subtype", value: "heels", scope: "category", categories: ["shoes"], slots: ["shoes"], combinationValues: [] } },
  { id: "less-tight", label: "Tight fits", polarity: "less", delta: { attribute: "fit", value: "slim", scope: "global_style", categories: [], slots: [], combinationValues: [] } },
  { id: "less-cropped", label: "Cropped tops", polarity: "less", delta: { attribute: "fit", value: "cropped", scope: "category", categories: ["top"], slots: ["top"], combinationValues: [] } },
  { id: "less-short-skirts", label: "Short skirts", polarity: "less", delta: { attribute: "subtype", value: "short_skirt", scope: "category", categories: ["bottom"], slots: ["bottom"], combinationValues: [] } },
  { id: "less-bright", label: "Bright colors", polarity: "less", delta: { attribute: "color", value: "chromatic", scope: "global_style", categories: [], slots: [], combinationValues: [] } },
  { id: "less-formal", label: "Formal looks", polarity: "less", delta: { attribute: "formality", value: "formal", scope: "global_style", categories: [], slots: [], combinationValues: [] } },
  { id: "less-gold", label: "Gold-tone jewelry", polarity: "less", delta: { attribute: "metal", value: "gold", scope: "category", categories: ["jewelry"], slots: ["jewelry"], combinationValues: [] } },
  { id: "less-silver", label: "Silver-tone jewelry", polarity: "less", delta: { attribute: "metal", value: "silver", scope: "category", categories: ["jewelry"], slots: ["jewelry"], combinationValues: [] } },
];

export const explicitPreferenceOptions = [...morePreferenceOptions, ...lessPreferenceOptions];

export function preferenceDeltaForOption(optionId: string): PreferenceDelta {
  const option = explicitPreferenceOptions.find((candidate) => candidate.id === optionId);
  if (!option) throw new Error(`Unknown explicit preference option: ${optionId}`);
  return PreferenceDeltaSchema.parse({
    action: "add",
    signalId: null,
    label: option.label,
    polarity: option.polarity,
    strength: "soft",
    confidence: 0.98,
    needsReview: false,
    evidenceSummary: `Selected ${option.label}`,
    ...option.delta,
  });
}
