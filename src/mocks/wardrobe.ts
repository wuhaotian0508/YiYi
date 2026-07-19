import type { PreferenceProfile, WardrobeItem } from "@/domain/schemas";

const now = 1_721_088_000_000;

function item(
  id: string,
  category: WardrobeItem["category"],
  subtype: string,
  primaryColor: WardrobeItem["primaryColor"],
  options: Partial<WardrobeItem> = {},
): WardrobeItem {
  return {
    id,
    schemaVersion: 1,
    category,
    subtype,
    primaryColor,
    secondaryColors: [],
    materials: ["Cotton"],
    pattern: "solid",
    fit: "regular",
    warmth: 3,
    formality: 2,
    comfort: 4,
    styleTags: ["clean", "relaxed"],
    occasionTags: ["everyday"],
    weatherTags: ["mild"],
    availability: "available",
    aiConfidence: { category: 0.96, colors: 0.95, materials: 0.82, pattern: 0.96 },
    internalDescription: `${primaryColor} ${subtype}`,
    userEditedFields: [],
    createdAt: now,
    updatedAt: now,
    lastWornAt: null,
    ...options,
  };
}

export const demoWardrobe: WardrobeItem[] = [
  item("11111111-1111-4111-8111-111111111111", "outerwear", "Long blazer", "brown", {
    materials: ["Wool"], warmth: 4, formality: 4, fit: "relaxed", styleTags: ["polished", "classic"],
  }),
  item("11111111-1111-4111-8111-111111111113", "outerwear", "Tailored blazer", "black", {
    materials: ["Wool"], warmth: 3, formality: 5, comfort: 3, styleTags: ["polished", "minimal"],
  }),
  item("22222222-2222-4222-8222-222222222221", "top", "Fine knit", "white", {
    materials: ["Knit"], fit: "relaxed", warmth: 3, styleTags: ["soft", "minimal"],
  }),
  item("22222222-2222-4222-8222-222222222222", "top", "Crew-neck sweater", "beige", {
    materials: ["Knit"], fit: "oversized", warmth: 4, styleTags: ["relaxed", "cozy"],
  }),
  item("22222222-2222-4222-8222-222222222223", "top", "Clean shirt", "blue", {
    materials: ["Cotton"], formality: 3, styleTags: ["clean", "classic"],
  }),
  item("33333333-3333-4333-8333-333333333331", "bottom", "Wide-leg jeans", "blue", {
    materials: ["Denim"], fit: "relaxed", comfort: 5, styleTags: ["relaxed", "cool"],
  }),
  item("33333333-3333-4333-8333-333333333332", "bottom", "Tailored trousers", "black", {
    materials: ["Wool"], formality: 4, comfort: 3, styleTags: ["polished", "minimal"],
  }),
  item("33333333-3333-4333-8333-333333333333", "bottom", "Soft shorts", "gray", {
    fit: "relaxed", warmth: 1, comfort: 5, styleTags: ["relaxed", "casual"],
  }),
  item("44444444-4444-4444-8444-444444444441", "shoes", "Leather sneakers", "white", {
    materials: ["Leather"], warmth: 2, comfort: 5, formality: 2, styleTags: ["clean", "sporty"],
  }),
  item("44444444-4444-4444-8444-444444444442", "shoes", "Black loafers", "black", {
    materials: ["Leather"], comfort: 3, formality: 4, styleTags: ["classic", "polished"],
  }),
  item("55555555-5555-4555-8555-555555555551", "bag", "Structured shoulder bag", "brown", {
    materials: ["Leather"], formality: 4, styleTags: ["classic", "polished"],
  }),
  item("55555555-5555-4555-8555-555555555552", "bag", "Soft crossbody bag", "brown", {
    materials: ["Suede"], formality: 2, comfort: 5, styleTags: ["relaxed", "soft"],
  }),
  item("66666666-6666-4666-8666-666666666661", "jewelry", "Silver hoops", "metallic", {
    materials: ["Metal"], warmth: 1, metal: "silver", styleTags: ["minimal", "cool"],
  }),
  item("66666666-6666-4666-8666-666666666662", "jewelry", "Fine gold necklace", "metallic", {
    materials: ["Metal"], warmth: 1, metal: "gold", styleTags: ["delicate", "classic"],
  }),
  item("77777777-7777-4777-8777-777777777771", "headwear", "Soft cap", "beige", {
    materials: ["Cotton"], warmth: 2, formality: 1, comfort: 5, styleTags: ["casual", "relaxed"],
  }),
  item("77777777-7777-4777-8777-777777777772", "eyewear", "Dark sunglasses", "black", {
    materials: ["Acetate"], warmth: 1, formality: 3, styleTags: ["cool", "minimal"],
  }),
];

export const demoIntent = {
  activities: [
    { label: "Gallery", timeOfDay: "afternoon" as const },
    { label: "Dinner with friends", timeOfDay: "evening" as const },
  ],
  aestheticTerms: ["photo-ready", "not overdressed"],
  desiredFormality: 3,
  comfortPriority: 4,
  photoPriority: 4,
  walkingIntensity: 4,
  excludedCategories: ["one_piece" as const],
  excludedItemIds: [],
  requiredItemIds: [],
  temporaryPreferences: [],
  freeformSummary: "Gallery, dinner with friends, photo-ready, not overdressed, and no dresses.",
};

export const demoPreferenceProfile: PreferenceProfile = {
  id: "default",
  wardrobeDirection: "mixed",
  styleVector: {
    relaxedPolished: -0.25,
    minimalExpressive: -0.45,
    softCool: 0.2,
    fittedOversized: 0.25,
    classicTrendAware: -0.1,
    feminineNeutral: 0.35,
  },
  styleFeedback: [
    { lookId: "look-2", sentiment: "like" },
    { lookId: "look-4", sentiment: "like" },
    { lookId: "look-1", sentiment: "dislike" },
  ],
  styleAnchors: [
    {
      id: "demo-relaxed-tailoring",
      label: "Relaxed tailoring",
      vector: { relaxedPolished: 0.35, minimalExpressive: -0.45, softCool: 0.15, fittedOversized: 0.25, classicTrendAware: -0.1, feminineNeutral: 0.35 },
      styleTags: { relaxed: 0.8, clean: 0.75, tailored: 0.7, cool: 0.45 },
      evidenceCount: 3,
      confidence: 0.65,
      updatedAt: now,
    },
  ],
  hardAvoids: [
    { key: "category", value: "heels", strength: "hard" },
  ],
  softPreferences: [
    { key: "style", value: "relaxed and clean", strength: "soft" },
    { key: "comfort", value: "comfortable shoes", strength: "soft" },
    { key: "style", value: "overly formal looks", strength: "soft", polarity: "avoid" },
  ],
  preferenceNotes: { moreOf: ["relaxed tailoring", "clean layers"], lessOf: ["overly formal"], freeform: "Comfortable enough for walking." },
  preferredMetals: ["silver"],
  comfortWeight: 0.8,
  formalityBias: -0.2,
  evidence: [
    { phrase: "Comfort over formality", source: "onboarding", createdAt: now },
    { phrase: "Usually prefer silver-tone jewelry", source: "onboarding", createdAt: now },
  ],
  provenance: "demo",
  updatedAt: now,
};
