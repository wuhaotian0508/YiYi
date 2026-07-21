import { z } from "zod";
import { DailyIntentSchema, type DailyIntent, type WardrobeItem } from "@/domain/schemas";
import { clothingCategories, colorIds } from "@/domain/taxonomy";

// Realtime extracts only short semantic phrases. It never invents local IDs or
// internal scoring fields; those are resolved and defaulted by the application.
export const InitialRecommendationVoiceRequestSchema = z.object({
  userRequest: z.string().trim().min(1).max(300),
  activityPhrases: z.array(z.string().trim().min(1).max(60)).max(8),
  desiredFeelings: z.array(z.string().trim().min(1).max(50)).max(8),
  exclusions: z.array(z.string().trim().min(1).max(60)).max(8),
  wardrobeAnchors: z.array(z.string().trim().min(1).max(80)).max(4),
}).strict();
export type InitialRecommendationVoiceRequest = z.infer<typeof InitialRecommendationVoiceRequestSchema>;

const categoryTerms: Array<[WardrobeItem["category"], RegExp]> = [
  ["one_piece", /\b(dress|jumpsuit|one[ -]?piece)\b/],
  ["outerwear", /\b(jacket|coat|blazer|outerwear)\b/],
  ["bottom", /\b(trousers|pants|jeans|shorts|skirt|bottoms?)\b/],
  ["top", /\b(hoodie|shirt|sweater|blouse|tee|t-?shirt|top)\b/],
  ["shoes", /\b(shoes?|sneakers?|trainers?|boots?|loafers?|heels?)\b/],
  ["bag", /\b(bag|tote|purse|crossbody)\b/],
  ["jewelry", /\b(jewelry|jewellery|necklace|earrings?|hoops?|bracelet|rings?)\b/],
  ["eyewear", /\b(sunglasses|glasses|eyewear)\b/],
  ["headwear", /\b(hat|cap|headwear)\b/],
  ["scarf", /\bscar(?:f|ves)\b/],
  ["belt", /\bbelts?\b/],
];

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function categoryIn(text: string) {
  return categoryTerms.find(([, expression]) => expression.test(text))?.[0] ?? null;
}

function explicitAnchorPhrases(userRequest: string) {
  const text = normalized(userRequest);
  if (/\b(?:no|not|without|avoid|exclude|don t want|less)\b/.test(text)) return [];
  const clauses = text.split(/[,.;!?]|\b(?:then|but)\b/).map((entry) => entry.trim()).filter(Boolean);
  return clauses.filter((clause) => /\b(?:wear|use|keep|include)\b|\bwith my\b/.test(clause) && categoryIn(clause));
}

export function resolveSemanticItemAnchors(anchorDescriptions: string[], wardrobe: WardrobeItem[]) {
  const requiredItemIds: string[] = [];
  const ambiguity: string[] = [];
  for (const rawDescription of anchorDescriptions) {
    const description = normalized(rawDescription);
    const requestedCategory = categoryIn(description);
    const requestedColors = colorIds.filter((color) => new RegExp(`\\b${color}\\b`).test(description));
    const matches = wardrobe.filter((item) => {
      if (item.availability !== "available") return false;
      if (requestedCategory && item.category !== requestedCategory) return false;
      if (requestedColors.length && !requestedColors.includes(item.primaryColor) && !item.secondaryColors.some((color) => requestedColors.includes(color))) return false;
      const subtypeTokens = normalized(item.subtype).split(" ").filter((token) => token.length >= 3);
      const subtypeMatches = subtypeTokens.some((token) => new RegExp(`\\b${token}\\b`).test(description));
      return requestedCategory !== null || subtypeMatches;
    });
    if (matches.length === 1) requiredItemIds.push(matches[0].id);
    else if (matches.length > 1) ambiguity.push(`Multiple available items match “${rawDescription}”.`);
    else ambiguity.push(`No available item matches “${rawDescription}”.`);
  }
  return { requiredItemIds: [...new Set(requiredItemIds)], ambiguity };
}

function timeOfDay(text: string): DailyIntent["activities"][number]["timeOfDay"] {
  if (/\bmorning\b/.test(text)) return "morning";
  if (/\bafternoon\b/.test(text)) return "afternoon";
  if (/\b(evening|tonight)\b/.test(text)) return "evening";
  if (/\b(all day|daylong)\b/.test(text)) return "all_day";
  return "unknown";
}

function activityLabels(text: string, phrases: string[]) {
  const candidates: Array<[string, RegExp]> = [
    ["Gallery", /\b(gallery|art museum|museum exhibit)\b/],
    ["Play basketball", /\b(play(?:ing)?|practice|game)\b[^.]{0,30}\bbasketball\b|\bbasketball\b[^.]{0,30}\b(play(?:ing)?|practice|game)\b/],
    ["Watch basketball", /\b(watch(?:ing)?|attend(?:ing)?|spectat(?:e|ing)|basketball game as a fan)\b[^.]{0,35}\bbasketball\b|\bbasketball\b[^.]{0,30}\bwatch(?:ing)?\b/],
    ["Lab", /\b(lab|laboratory|chemistry practical)\b/],
    ["Running", /\b(run(?:ning)?|jog(?:ging)?|5k|marathon)\b/],
    ["Gym", /\b(gym|workout|weightlifting|training session)\b/],
    ["Hiking", /\b(hike|hiking|trail)\b/],
    ["Interview", /\binterview\b/],
    ["Wedding", /\bwedding\b/],
    ["Rain commute", /\b(?:rain(?:y)?[^.]{0,25}commut|commut[^.]{0,25}rain)\w*\b/],
    ["Dinner", /\bdinner\b/],
    ["Class", /\b(class|lecture|campus)\b/],
    ["Lots of walking", /\b(lots? of walking|walking all day)\b/],
  ];
  const combined = normalized(`${text} ${phrases.join(" ")}`);
  const labels = candidates.filter(([, expression]) => expression.test(combined)).map(([label]) => label);
  if (!labels.length) labels.push(...phrases.map((phrase) => phrase.trim()).filter(Boolean));
  return [...new Set(labels)].slice(0, 8).map((label) => ({ label, timeOfDay: timeOfDay(combined) }));
}

function excludedCategories(text: string, explicitExclusions: string[]) {
  const clauses = normalized(`${text} ${explicitExclusions.join(" ")}`);
  return clothingCategories.filter((category) => {
    const terms = categoryTerms.find(([candidate]) => candidate === category)?.[1];
    if (!terms) return false;
    return clauses.split(/\b(?:but|except)\b|[,.;!?]/).some((clause) => /\b(no|without|avoid|exclude|don t want|not wearing)\b/.test(clause) && terms.test(clause));
  });
}

export function buildDailyIntentFromVoiceRequest(input: InitialRecommendationVoiceRequest, wardrobe: WardrobeItem[]): DailyIntent {
  const parsed = InitialRecommendationVoiceRequestSchema.parse(input);
  const text = normalized(parsed.userRequest);
  const anchors = [...parsed.wardrobeAnchors, ...explicitAnchorPhrases(parsed.userRequest)];
  const resolvedAnchors = resolveSemanticItemAnchors([...new Set(anchors)], wardrobe);
  const aestheticTerms = [...parsed.desiredFeelings, ...[
    ["relaxed", /\b(relaxed|casual|easy)\b/],
    ["polished", /\b(polished|put together|smart)\b/],
    ["photo-ready", /\b(photo ready|photogenic|photos?)\b/],
    ["comfortable", /\b(comfortable|comfort)\b/],
  ].flatMap(([label, expression]) => (expression as RegExp).test(text) ? [label as string] : [])];
  const walkingIntensity = /\b(lots? of walking|walking all day|hiking|running)\b/.test(text) ? 5 : /\bwalk(?:ing)?\b/.test(text) ? 3 : 2;
  return DailyIntentSchema.parse({
    activities: activityLabels(parsed.userRequest, parsed.activityPhrases),
    aestheticTerms: [...new Set(aestheticTerms.map(normalized).filter(Boolean))],
    comfortPriority: /\b(comfortable|comfort|relaxed|walking|hiking|running|gym|basketball)\b/.test(text) ? 5 : 3,
    photoPriority: /\b(photo ready|photogenic|photos?)\b/.test(text) ? 5 : 3,
    walkingIntensity,
    excludedCategories: excludedCategories(parsed.userRequest, parsed.exclusions),
    excludedItemIds: [],
    requiredItemIds: resolvedAnchors.requiredItemIds,
    temporaryPreferences: [],
    temporaryItemRules: [],
    freeformSummary: parsed.userRequest,
    confidence: resolvedAnchors.ambiguity.length ? 0.65 : 0.9,
    ambiguity: resolvedAnchors.ambiguity,
  });
}

export function emptyDailyIntent(): DailyIntent {
  return DailyIntentSchema.parse({
    activities: [], aestheticTerms: [], comfortPriority: 3, photoPriority: 3, walkingIntensity: 2,
    excludedCategories: [], excludedItemIds: [], requiredItemIds: [], temporaryPreferences: [], temporaryItemRules: [], freeformSummary: "",
  });
}
