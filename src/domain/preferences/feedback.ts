import { PreferenceProfileSchema, type DailyIntent, type Outfit, type PreferenceProfile, type WardrobeItem } from "@/domain/schemas";

const learnableStyleTags = new Set(["classic", "clean", "cool", "delicate", "expressive", "feminine", "minimal", "modern", "polished", "refined", "relaxed", "soft", "sporty", "statement", "tailored", "timeless", "utility"]);

export function saveUnstructuredVoicePreference(input: { profile: PreferenceProfile; rule: string; polarity: "prefer" | "avoid"; evidencePhrase: string; now?: number }) {
  const now = input.now ?? Date.now();
  const note = { key: "voice-note", value: input.rule.trim().toLowerCase(), strength: "soft" as const, polarity: input.polarity };
  return PreferenceProfileSchema.parse({
    ...input.profile,
    provenance: "personal",
    softPreferences: [...input.profile.softPreferences.filter((rule) => !(rule.key === note.key && rule.value === note.value)), note].slice(-40),
    evidence: [...input.profile.evidence, { phrase: input.evidencePhrase, source: "explicit_voice" as const, createdAt: now }].slice(-100),
    updatedAt: now,
  });
}

export function updateProfileFromOutfitFeedback(input: {
  profile: PreferenceProfile;
  outfit: Outfit;
  wardrobe: WardrobeItem[];
  kind: "confirmed";
  intent?: DailyIntent;
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
  const existing = input.profile.styleAnchors.find((anchor) => anchor.id === "learned-confirmed");
  const count = (existing?.evidenceCount ?? 0) + 1;
  const styleTags = { ...(existing?.styleTags ?? {}) };
  for (const tag of tags) styleTags[tag] = Math.min(1, (styleTags[tag] ?? 0) * 0.88 + 0.12);
  const anchor = {
    id: "learned-confirmed",
    label: "Outfits you wear",
    vector: existing?.vector ?? input.profile.styleVector,
    styleTags,
    evidenceCount: count,
    confidence: Math.min(0.82, 0.12 + count * 0.1),
    updatedAt: now,
  };
  return PreferenceProfileSchema.parse({
    ...input.profile,
    styleAnchors: [...input.profile.styleAnchors.filter((entry) => entry.id !== anchor.id), anchor].slice(-4),
    evidence: [...input.profile.evidence, evidence].slice(-100),
    provenance: "personal",
    updatedAt: now,
  });
}
