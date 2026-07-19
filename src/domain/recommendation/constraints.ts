import { OutfitItemIdsSchema, type OutfitItemIds, type OutfitSlot, type WardrobeItem } from "@/domain/schemas";
import { RecommendationError, type RecommendationContext } from "@/domain/recommendation/context";
import { colorIds } from "@/domain/taxonomy";

export type ConstraintViolationCode =
  | "INVALID_STRUCTURE"
  | "MISSING_ITEM"
  | "WRONG_SLOT_CATEGORY"
  | "DUPLICATE_ITEM"
  | "ITEM_UNAVAILABLE"
  | "ITEM_EXCLUDED"
  | "CATEGORY_EXCLUDED"
  | "REQUIRED_ITEM_MISSING"
  | "HARD_AVOID"
  | "RAIN_UNSAFE"
  | "WALKING_UNSAFE"
  | "PRESERVED_SLOT_CHANGED";

export type ConstraintViolation = {
  code: ConstraintViolationCode;
  message: string;
  itemIds?: string[];
  slots?: OutfitSlot[];
};

export type ValidationResult = { valid: boolean; violations: ConstraintViolation[] };

export const slotCategories: Record<OutfitSlot, WardrobeItem["category"][]> = {
  top: ["top"],
  bottom: ["bottom"],
  onePiece: ["one_piece"],
  outerwear: ["outerwear"],
  shoes: ["shoes"],
  bag: ["bag"],
  jewelry: ["jewelry"],
  extraAccessory: ["headwear", "scarf", "belt", "eyewear", "hair_accessory", "other_accessory"],
};

export function slotForItem(item: WardrobeItem): OutfitSlot {
  if (item.category === "one_piece") return "onePiece";
  if (item.category === "headwear" || item.category === "scarf" || item.category === "belt" || item.category === "eyewear" || item.category === "hair_accessory" || item.category === "other_accessory") return "extraAccessory";
  return item.category as OutfitSlot;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replaceAll("-tone", "");
}

const categoryTerms: Partial<Record<WardrobeItem["category"], string[]>> = {
  top: ["top", "shirt", "sweater", "blouse", "tee", "t-shirt", "knit"],
  bottom: ["bottom", "pants", "trousers", "jeans", "shorts", "skirt"],
  one_piece: ["dress", "one piece", "jumpsuit"],
  outerwear: ["outerwear", "jacket", "coat", "blazer"],
  shoes: ["shoe", "shoes", "sneaker", "loafer", "boot", "heel"],
  bag: ["bag", "tote", "crossbody", "purse"],
  jewelry: ["jewelry", "necklace", "earring", "hoop", "bracelet", "ring"],
  headwear: ["hat", "cap", "headwear"],
  scarf: ["scarf"],
  belt: ["belt"],
  eyewear: ["glasses", "eyewear", "sunglasses"],
  hair_accessory: ["hair accessory", "hair clip", "headband"],
};

function ruleMentionsAnotherCategory(value: string, item: WardrobeItem) {
  const mentioned = Object.entries(categoryTerms).filter(([, terms]) => terms.some((term) => value.includes(term))).map(([category]) => category);
  return mentioned.length > 0 && !mentioned.includes(item.category);
}

function hardAvoidReason(item: WardrobeItem, context: RecommendationContext) {
  const rules = [
    ...context.profile.hardAvoids.filter((entry) => entry.polarity !== "prefer"),
    ...(context.intent.temporaryItemRules ?? []).filter((entry) => entry.polarity === "avoid"),
  ].filter((entry) => entry.strength === "hard");
  for (const rule of rules) {
    const value = normalize(rule.value);
    const haystack = [item.category, item.subtype, item.primaryColor, item.fit, item.metal, ...item.materials, ...item.styleTags].filter(Boolean).map(String).map(normalize);
    const categories = "categories" in rule && Array.isArray(rule.categories) ? rule.categories as WardrobeItem["category"][] : [];
    const slots = "slots" in rule && Array.isArray(rule.slots) ? rule.slots as OutfitSlot[] : [];
    const mentionedColors = colorIds.filter((color) => new RegExp(`(^|[^a-z])${color.replaceAll("_", "[ _-]")}([^a-z]|$)`).test(value));
    if (categories.length && !categories.includes(item.category)) continue;
    if (slots.length && !slots.includes(slotForItem(item))) continue;
    if (!categories.length && !slots.length && ruleMentionsAnotherCategory(value, item)) continue;
    if (value.includes("heel") && item.category === "shoes" && haystack.some((entry) => entry.includes("heel"))) return rule.value;
    if ((value.includes("dress") || value.includes("one piece")) && item.category === "one_piece") return rule.value;
    if (value.includes("gold") && item.metal === "gold") return rule.value;
    if (value.includes("silver") && item.metal === "silver") return rule.value;
    if (value.includes("cropped") && item.fit === "cropped") return rule.value;
    if (value.includes("leather") && item.materials.some((material) => normalize(material).includes("leather"))) return rule.value;
    if ((value.includes("overly formal") || value.includes("too formal")) && item.formality >= 4) return rule.value;
    if ((value.includes("uncomfortable") || value.includes("low comfort")) && item.comfort <= 2) return rule.value;
    if (rule.key === "category" && haystack.some((entry) => entry === value || entry.includes(value) || value === `${entry}s`)) return rule.value;
    if (rule.key === "material" && item.materials.some((entry) => normalize(entry).includes(value))) return rule.value;
    if (rule.key === "fit" && normalize(item.fit).includes(value)) return rule.value;
    if (rule.key === "color" && [item.primaryColor, ...item.secondaryColors].some((entry) => normalize(entry).includes(value))) return rule.value;
    if (rule.key === "subtype" && normalize(item.subtype).includes(value)) return rule.value;
    if (rule.key === "metal" && normalize(item.metal ?? "unknown").includes(value)) return rule.value;
    if (["style", "manual", "voice", "onboarding"].includes(rule.key)) {
      // Free-form rules are compiled only when they describe one unambiguous item attribute.
      // Combination phrases such as "black and white together" remain editable notes.
      if (mentionedColors.length === 1 && [item.primaryColor, ...item.secondaryColors].includes(mentionedColors[0])) return rule.value;
      const matchingCategories = Object.entries(categoryTerms).filter(([, terms]) => terms.some((term) => value.includes(term))).map(([category]) => category);
      if (matchingCategories.length === 1 && matchingCategories[0] === item.category && mentionedColors.length === 0) return rule.value;
    }
  }
  return null;
}

export function validateRequiredAnchors(context: RecommendationContext) {
  const slots = new Map<OutfitSlot, string>();
  for (const id of context.requiredItemIds) {
    const item = context.wardrobeIndex.get(id);
    if (!item) throw new RecommendationError("UNKNOWN_ITEM_ID", "A required item no longer exists.", [id]);
    if (item.availability !== "available") throw new RecommendationError("CONFLICTING_REQUIRED_ITEMS", `Required item “${item.subtype}” is not available.`, [id]);
    if (context.excludedItemIds.has(id)) throw new RecommendationError("CONFLICTING_REQUIRED_ITEMS", `Required item “${item.subtype}” is also excluded.`, [id]);
    if (context.excludedCategories.has(item.category)) throw new RecommendationError("CONFLICTING_REQUIRED_ITEMS", `Required item “${item.subtype}” belongs to an excluded category.`, [id]);
    const avoid = hardAvoidReason(item, context);
    if (avoid) throw new RecommendationError("CONFLICTING_REQUIRED_ITEMS", `Required item “${item.subtype}” conflicts with “${avoid}”.`, [id]);
    if (context.weather?.expectedRain && item.weatherTags.includes("dry_only")) throw new RecommendationError("CONFLICTING_REQUIRED_ITEMS", `Required item “${item.subtype}” is dry-only in expected rain.`, [id]);
    if (context.intent.walkingIntensity >= 5 && item.category === "shoes" && item.comfort < 3) throw new RecommendationError("CONFLICTING_REQUIRED_ITEMS", `Required shoes “${item.subtype}” are unsuitable for extended walking.`, [id]);
    const slot = slotForItem(item);
    const existing = slots.get(slot);
    if (existing && existing !== id) throw new RecommendationError("CONFLICTING_REQUIRED_ITEMS", `Two required items compete for the ${slot} slot.`, [existing, id]);
    slots.set(slot, id);
  }
  if (slots.has("onePiece") && (slots.has("top") || slots.has("bottom"))) {
    throw new RecommendationError("CONFLICTING_REQUIRED_ITEMS", "A required one-piece cannot be combined with a required top or bottom.", [...context.requiredItemIds]);
  }
  return slots;
}

export function validateOutfit(ids: OutfitItemIds, context: RecommendationContext): ValidationResult {
  const violations: ConstraintViolation[] = [];
  const parsedStructure = OutfitItemIdsSchema.safeParse(ids);
  if (!parsedStructure.success) violations.push({ code: "INVALID_STRUCTURE", message: "The outfit does not have one legal core structure." });
  const seen = new Set<string>();

  for (const [slot, id] of Object.entries(ids) as [OutfitSlot, string | undefined][]) {
    if (!id) continue;
    if (seen.has(id)) violations.push({ code: "DUPLICATE_ITEM", message: "An item occupies more than one slot.", itemIds: [id] });
    seen.add(id);
    const item = context.wardrobeIndex.get(id);
    if (!item) { violations.push({ code: "MISSING_ITEM", message: "An outfit item no longer exists.", itemIds: [id], slots: [slot] }); continue; }
    if (!slotCategories[slot].includes(item.category)) violations.push({ code: "WRONG_SLOT_CATEGORY", message: `${item.subtype} cannot occupy ${slot}.`, itemIds: [id], slots: [slot] });
    if (item.availability !== "available") violations.push({ code: "ITEM_UNAVAILABLE", message: `${item.subtype} is not available.`, itemIds: [id] });
    if (context.excludedItemIds.has(id)) violations.push({ code: "ITEM_EXCLUDED", message: `${item.subtype} was explicitly excluded.`, itemIds: [id] });
    if (context.excludedCategories.has(item.category)) violations.push({ code: "CATEGORY_EXCLUDED", message: `${item.category} was explicitly excluded.`, itemIds: [id] });
    const avoid = hardAvoidReason(item, context);
    if (avoid) violations.push({ code: "HARD_AVOID", message: `${item.subtype} conflicts with “${avoid}”.`, itemIds: [id] });
    if (context.weather?.expectedRain && item.weatherTags.includes("dry_only")) violations.push({ code: "RAIN_UNSAFE", message: `${item.subtype} is marked dry-only.`, itemIds: [id] });
  }

  for (const id of context.requiredItemIds) {
    if (!seen.has(id)) violations.push({ code: "REQUIRED_ITEM_MISSING", message: "A required item is missing.", itemIds: [id] });
  }
  if (context.intent.walkingIntensity >= 5 && ids.shoes) {
    const shoes = context.wardrobeIndex.get(ids.shoes);
    if (shoes && shoes.comfort < 3) violations.push({ code: "WALKING_UNSAFE", message: `${shoes.subtype} is unsuitable for extended walking.`, itemIds: [shoes.id] });
  }
  if (context.currentOutfit) {
    for (const slot of context.preserveSlots) {
      if (context.currentOutfit.itemIds[slot] !== ids[slot]) violations.push({ code: "PRESERVED_SLOT_CHANGED", message: `${slot} must remain unchanged.`, slots: [slot] });
    }
  }
  return { valid: violations.length === 0, violations };
}

export function validatePartial(ids: Partial<OutfitItemIds>, context: RecommendationContext, remainingSlots: Set<OutfitSlot>): ValidationResult {
  const violations: ConstraintViolation[] = [];
  const values = Object.values(ids).filter((id): id is string => Boolean(id));
  if (new Set(values).size !== values.length) violations.push({ code: "DUPLICATE_ITEM", message: "An item occupies more than one slot." });
  for (const [slot, id] of Object.entries(ids) as [OutfitSlot, string | undefined][]) {
    if (!id) continue;
    const item = context.wardrobeIndex.get(id);
    if (!item) { violations.push({ code: "MISSING_ITEM", message: "An item no longer exists.", itemIds: [id] }); continue; }
    if (!slotCategories[slot].includes(item.category)) violations.push({ code: "WRONG_SLOT_CATEGORY", message: "An item is in the wrong slot.", itemIds: [id], slots: [slot] });
    if (item.availability !== "available") violations.push({ code: "ITEM_UNAVAILABLE", message: "A partial candidate contains an unavailable item.", itemIds: [id] });
    if (context.excludedItemIds.has(id)) violations.push({ code: "ITEM_EXCLUDED", message: "A partial candidate contains an explicitly excluded item.", itemIds: [id] });
    if (context.excludedCategories.has(item.category)) violations.push({ code: "CATEGORY_EXCLUDED", message: "A partial candidate contains an excluded category.", itemIds: [id] });
    if (hardAvoidReason(item, context)) violations.push({ code: "HARD_AVOID", message: "A partial candidate conflicts with a compiled hard avoid.", itemIds: [id] });
    if (context.weather?.expectedRain && item.weatherTags.includes("dry_only")) violations.push({ code: "RAIN_UNSAFE", message: "A partial candidate is dry-only in expected rain.", itemIds: [id] });
  }
  for (const id of context.requiredItemIds) {
    if (values.includes(id)) continue;
    const item = context.wardrobeIndex.get(id);
    if (item && !remainingSlots.has(slotForItem(item))) violations.push({ code: "REQUIRED_ITEM_MISSING", message: "A partial candidate can no longer include a required item.", itemIds: [id] });
  }
  if (context.currentOutfit) {
    for (const slot of context.preserveSlots) {
      if (!(slot in ids)) continue;
      if (ids[slot] !== context.currentOutfit.itemIds[slot]) violations.push({ code: "PRESERVED_SLOT_CHANGED", message: `${slot} must remain unchanged.`, slots: [slot] });
    }
  }
  return { valid: violations.length === 0, violations };
}
