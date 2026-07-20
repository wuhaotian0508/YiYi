import { applyPreferenceDelta, rebuildProfileFromSignals } from "@/domain/preferences/profile-mutations";
import { PreferenceDeltaSchema, PreferenceProfileSchema, PreferenceSignalSchema, type DailyIntent, type Outfit, type PreferenceProfile, type WardrobeItem } from "@/domain/schemas";

const learnableStyleTags = new Set(["classic", "clean", "cool", "delicate", "expressive", "feminine", "minimal", "modern", "polished", "refined", "relaxed", "soft", "sporty", "statement", "tailored", "timeless", "utility"]);

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function saveUnstructuredVoicePreference(input: { profile: PreferenceProfile; rule: string; polarity: "prefer" | "avoid"; evidencePhrase: string; now?: number }) {
  const now = input.now ?? Date.now();
  return applyPreferenceDelta({
    profile: input.profile,
    delta: PreferenceDeltaSchema.parse({
      action: "add",
      signalId: null,
      attribute: "preference_note",
      value: input.rule.trim().toLowerCase(),
      label: input.rule.trim(),
      polarity: input.polarity === "avoid" ? "less" : "more",
      strength: "soft",
      scope: "global_style",
      categories: [],
      slots: [],
      combinationValues: [],
      confidence: 0.5,
      needsReview: true,
      evidenceSummary: input.evidencePhrase,
    }),
    now,
    source: "explicit_voice",
  });
}

export function updateProfileFromOutfitFeedback(input: {
  profile: PreferenceProfile;
  outfit: Outfit;
  wardrobe: WardrobeItem[];
  kind: "confirmed";
  intent?: DailyIntent;
  contextId?: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const lookup = new Map(input.wardrobe.map((item) => [item.id, item]));
  const items = Object.values(input.outfit.itemIds).map((id) => lookup.get(id)).filter((item): item is WardrobeItem => Boolean(item));
  const contextualTags = new Set(input.intent?.aestheticTerms.map((term) => term.toLowerCase()) ?? []);
  const tags = [...new Set(items.flatMap((item) => item.styleTags))]
    .filter((tag) => learnableStyleTags.has(tag) && !contextualTags.has(tag))
    .slice(0, 8);
  const evidence = {
    phrase: `Confirmed outfit: ${tags.join(", ") || "no stable style signal"}`,
    source: "confirmation" as const,
    createdAt: now,
  };
  const existingSignals = input.profile.preferenceSignals ?? [];
  const contextId = input.contextId?.trim().slice(0, 160) || "unknown-context";
  const contextualSignals = tags.map((tag) => {
    const id = `confirmation:context:${stableHash(contextId)}:style:${tag}`;
    return PreferenceSignalSchema.parse({
      id,
      attribute: "style",
      value: tag,
      label: tag.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
      polarity: "more",
      strength: "soft",
      confidence: 0.18,
      scope: "contextual",
      categories: [],
      slots: [],
      permanence: "contextual",
      editable: true,
      status: "active",
      combinationValues: [],
      styleTags: [tag],
      provenance: { source: "confirmation", sourceId: contextId, createdAt: now },
    });
  });
  const withContext = [...existingSignals.filter((signal) => !contextualSignals.some((next) => next.id === signal.id)), ...contextualSignals];
  const learnedSignals = tags.flatMap((tag) => {
    const sourceIds = new Set(withContext
      .filter((signal) => signal.provenance.source === "confirmation"
        && signal.attribute === "style"
        && signal.value === tag
        && signal.status === "active"
        && signal.permanence === "contextual"
        && signal.provenance.sourceId)
      .map((signal) => signal.provenance.sourceId!)
      .filter((sourceId) => sourceId !== "unknown-context"));
    if (sourceIds.size < 2) return [];
    const id = `confirmation:learned:style:${tag}`;
    return [PreferenceSignalSchema.parse({
      id,
      attribute: "style",
      value: tag,
      label: tag.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
      polarity: "more",
      strength: "soft",
      confidence: Math.min(0.7, 0.18 + sourceIds.size * 0.12),
      scope: "global_style",
      categories: [],
      slots: [],
      permanence: "long_term",
      editable: true,
      status: "active",
      combinationValues: [],
      styleTags: [tag],
      provenance: { source: "confirmation", sourceId: `cross-context:${stableHash([...sourceIds].sort().join("|"))}`, createdAt: now },
    })];
  });
  const nextSignals = [
    ...withContext.filter((signal) => !learnedSignals.some((next) => next.id === signal.id)),
    ...learnedSignals,
  ];
  return PreferenceProfileSchema.parse({
    ...rebuildProfileFromSignals({ profile: input.profile, signals: nextSignals, now }),
    origin: learnedSignals.length > 0 ? "learned" : input.profile.origin,
    evidence: [...input.profile.evidence, evidence].slice(-100),
    provenance: "personal",
    updatedAt: now,
  });
}
