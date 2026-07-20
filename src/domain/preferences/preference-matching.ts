import type { OutfitSlot, PreferenceSignal, WardrobeItem } from "@/domain/schemas";

const accessoryCategories = new Set<WardrobeItem["category"]>([
  "headwear",
  "scarf",
  "belt",
  "eyewear",
  "hair_accessory",
  "other_accessory",
]);
const neutralColors = new Set(["black", "white", "gray", "beige", "brown", "navy", "metallic"]);

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replaceAll("-tone", "").replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ");
}

function slotForCategory(category: WardrobeItem["category"]): OutfitSlot {
  if (category === "one_piece") return "onePiece";
  if (accessoryCategories.has(category)) return "extraAccessory";
  return category as OutfitSlot;
}

function signalAppliesToItem(signal: PreferenceSignal, item: WardrobeItem) {
  if (signal.categories.length > 0 && !signal.categories.includes(item.category)) return false;
  if (signal.slots.length > 0 && !signal.slots.includes(slotForCategory(item.category))) return false;
  return true;
}

function normalizedCategory(value: string) {
  const normalized = normalize(value).replaceAll(" ", "_");
  if (normalized === "dress" || normalized === "dresses" || normalized === "onepiece") return "one_piece";
  if (normalized === "tops") return "top";
  if (normalized === "bottoms" || normalized === "trousers" || normalized === "pants") return "bottom";
  if (normalized === "shoe" || normalized === "shoes") return "shoes";
  if (normalized === "bags") return "bag";
  return normalized.replace(/s$/, "");
}

function numericTarget(value: string) {
  const match = value.match(/(?:^|\s)([1-5])(?:$|\s)/);
  return match ? Number(match[1]) : null;
}

/** Matches one structured preference against one item without interpreting prose. */
export function matchesPreferenceSignal(item: WardrobeItem, signal: PreferenceSignal) {
  if (!signalAppliesToItem(signal, item)) return false;
  const value = normalize(signal.value);
  const subtype = normalize(item.subtype);
  const styles = item.styleTags.map(normalize);
  const materials = item.materials.map(normalize);
  const colors = [item.primaryColor, ...item.secondaryColors].map(normalize);

  switch (signal.attribute) {
    case "style":
      return styles.includes(value) || styles.some((tag) => value === `${tag} style`);
    case "fit":
      return normalize(item.fit) === value || subtype === value || subtype === `${value} fit`;
    case "color":
      if (value === "chromatic") return colors.some((color) => !neutralColors.has(color));
      return colors.includes(value);
    case "material":
      return materials.includes(value);
    case "category":
      return item.category === normalizedCategory(value) || subtype === value;
    case "subtype":
      if (value === "heels") return item.category === "shoes" && /(?:^|\s)(?:heel|heels|heeled|pump|pumps|stiletto|stilettos)(?:\s|$)/.test(subtype);
      if (value === "short skirt") {
        const words = new Set(subtype.split(" "));
        return item.category === "bottom" && words.has("skirt") && (words.has("short") || words.has("mini"));
      }
      return subtype === value;
    case "metal":
      return normalize(item.metal ?? "unknown") === value;
    case "comfort": {
      const target = numericTarget(value);
      if (target !== null) return item.comfort === target;
      if (["comfortable", "high comfort", "walking friendly", "walkable"].includes(value)) return item.comfort >= 4;
      if (["uncomfortable", "low comfort"].includes(value)) return item.comfort <= 2;
      return false;
    }
    case "formality": {
      const target = numericTarget(value);
      if (target !== null) return item.formality === target;
      if (["formal", "high formality"].includes(value)) return item.formality >= 4;
      if (["casual", "low formality"].includes(value)) return item.formality <= 2;
      return false;
    }
    // A complete look is represented by its vector/anchor. Free-form notes are
    // editable evidence only, and combinations are evaluated at outfit level.
    case "style_look":
    case "preference_note":
    case "combination":
      return false;
  }
}

function matchesAtomicCombinationValue(item: WardrobeItem, rawValue: string) {
  const value = normalize(rawValue);
  const category = normalizedCategory(value);
  return [item.primaryColor, ...item.secondaryColors].map(normalize).includes(value)
    || normalize(item.metal ?? "unknown") === value
    || normalize(item.fit) === value
    || item.materials.map(normalize).includes(value)
    || item.styleTags.map(normalize).includes(value)
    || item.category === category
    || normalize(item.subtype) === value;
}

/** A combination is conjunctive; no component becomes an item-level ban. */
export function outfitMatchesCombinationSignal(items: readonly WardrobeItem[], signal: PreferenceSignal) {
  if (signal.attribute !== "combination" || signal.combinationValues.length < 2) return false;
  const scopedItems = items.filter((item) => signalAppliesToItem(signal, item));
  return signal.combinationValues.every((value) => scopedItems.some((item) => matchesAtomicCombinationValue(item, value)));
}
