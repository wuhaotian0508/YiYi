import { IntentDeltaSchema, type IntentDelta, type Outfit, type OutfitSlot, type WardrobeItem } from "@/domain/schemas";
import type { VoiceTurnAction } from "@/lib/realtime/voice-session";

const zeroAdjustments = { formality: 0, warmth: 0, comfort: 0, colorfulness: 0, walkingPriority: 0, layering: 0, structure: 0 };

// Spoken slot words the Realtime model may restate in the user's own language.
// Chinese has no word boundaries, so these are ordered most-specific-first:
// 连衣裙 contains 裙, 包包 contains 包, and 运动鞋 contains 鞋.
const chineseSlotTerms: Array<[OutfitSlot, string[]]> = [
  ["onePiece", ["连衣裙", "连身裙", "连体裤", "连衣"]],
  ["extraAccessory", ["墨镜", "太阳镜", "眼镜", "帽子", "围巾", "腰带", "发饰", "配饰"]],
  ["jewelry", ["项链", "耳环", "耳钉", "手链", "手镯", "戒指", "首饰"]],
  ["bag", ["手提包", "单肩包", "斜挎包", "双肩包", "托特包", "背包", "包包", "手袋", "包"]],
  ["shoes", ["运动鞋", "球鞋", "靴子", "高跟鞋", "乐福鞋", "皮鞋", "鞋子", "鞋"]],
  ["outerwear", ["西装外套", "风衣", "大衣", "夹克", "外套"]],
  ["bottom", ["牛仔裤", "短裤", "长裤", "裤子", "半身裙", "裙子", "下装", "裤", "裙"]],
  ["top", ["针织衫", "卫衣", "毛衣", "衬衫", "上衣", "上装", "t恤"]],
];

function chineseSlotIn(text: string) {
  return chineseSlotTerms.find(([, terms]) => terms.some((term) => text.includes(term)))?.[0] ?? null;
}

export function inferVoiceTargetSlot(request: string, explicit: OutfitSlot | null, focused: OutfitSlot | null): OutfitSlot | null {
  if (explicit) return explicit;
  const text = request.toLowerCase();
  const chinese = chineseSlotIn(text);
  if (chinese) return chinese;
  if (/sunglasses|glasses|eyewear|hat|cap|scarf|belt|accessory/.test(text)) return "extraAccessory";
  if (/jewelry|jewellery|necklace|earrings?|hoops?|bracelet|rings?/.test(text)) return "jewelry";
  if (/bag|tote|purse|crossbody/.test(text)) return "bag";
  if (/shoes?|sneakers?|trainers?|boots?|loafers?|heels?/.test(text)) return "shoes";
  if (/jacket|coat|blazer|outerwear/.test(text)) return "outerwear";
  if (/trousers|pants|jeans|shorts|skirt|bottom/.test(text)) return "bottom";
  if (/dress|jumpsuit|one[ -]?piece/.test(text)) return "onePiece";
  if (/hoodie|shirt|sweater|blouse|tee|top/.test(text)) return "top";
  return focused;
}

const slotTerms: Record<OutfitSlot, RegExp> = {
  top: /\b(hoodie|shirt|sweater|blouse|tee|top)\b/,
  bottom: /\b(trousers|pants|jeans|shorts|skirt|bottom)\b/,
  onePiece: /\b(dress|jumpsuit|one[ -]?piece)\b/,
  outerwear: /\b(jacket|coat|blazer|outerwear)\b/,
  shoes: /\b(shoes?|sneakers?|trainers?|boots?|loafers?|heels?)\b/,
  bag: /\b(bag|tote|purse|crossbody)\b/,
  jewelry: /\b(jewelry|jewellery|necklace|earrings?|hoops?|bracelet|rings?)\b/,
  extraAccessory: /\b(sunglasses|glasses|eyewear|hat|cap|scarf|belt|accessory)\b/,
};

function explicitlyPreservedSlots(request: string) {
  const text = request.toLowerCase();
  const clauses = [...text.matchAll(/\b(?:keep|preserve)\b([^.!?;]*)/g)].map((match) => match[1] ?? "");
  return (Object.entries(slotTerms) as [OutfitSlot, RegExp][])
    .filter(([, terms]) => clauses.some((clause) => terms.test(clause)))
    .map(([slot]) => slot);
}

function adjustmentFor(request: string) {
  const text = request.toLowerCase();
  return {
    formality: /more formal|dressier|polished|正式|优雅|精致/.test(text) ? 0.6 : /less formal|casual|relaxed|休闲|随意/.test(text) ? -0.6 : 0,
    warmth: /warmer|cold|暖|保暖|冷/.test(text) ? 0.7 : /cooler|too warm|hot|凉快|太热/.test(text) ? -0.7 : 0,
    comfort: /comfortable|comfort|relaxed|walking|hiking|running|gym|basketball|舒服|舒适|走路|散步|运动|健身/.test(text) ? 0.7 : 0,
    colorfulness: /more colou?r|brighter|鲜艳|亮一点|多点颜色/.test(text) ? 0.6 : /less colou?r|neutral|素一点|低调|中性色/.test(text) ? -0.6 : 0,
    walkingPriority: /walking|hiking|running|gym|basketball|走路|散步|徒步|运动|健身/.test(text) ? 1 : 0,
    layering: /layer|jacket|coat|叠穿|外套|大衣/.test(text) ? 0.4 : 0,
    structure: /structured|tailored|挺括|有型/.test(text) ? 0.5 : /soft|relaxed|柔软|宽松/.test(text) ? -0.4 : 0,
  };
}

function requestedAvailableItemIds(request: string, wardrobe: WardrobeItem[]) {
  const text = request.toLowerCase();
  // Item identity requires explicit designation. Descriptive style and colour
  // language alone ("more relaxed", "less blue") must never become an anchor.
  if (!/\b(wear|use|keep|include)\b|\bwith my\b/.test(text)) return [];
  if (/\b(no|not|without|avoid|exclude|don['’]?t want|less)\b/.test(text)) return [];
  const matches = wardrobe.filter((item) => {
    if (item.availability !== "available") return false;
    const phrases = [item.subtype, `${item.primaryColor} ${item.subtype}`].map((value) => value.toLowerCase());
    return phrases.some((phrase) => phrase.length >= 4 && text.includes(phrase));
  });
  return matches.length === 1 ? [matches[0].id] : [];
}

function temporaryRulesFor(request: string) {
  const text = request.toLowerCase();
  const negative = /\b(less|no|not|without|avoid|exclude|don['’]?t want)\b/.test(text);
  if (!negative) return [];
  const color = ["black", "white", "gray", "beige", "brown", "navy", "blue", "green", "red", "pink", "purple", "yellow", "orange"]
    .find((candidate) => new RegExp(`\\b${candidate}\\b`).test(text));
  return color ? [{ key: "color" as const, value: color, polarity: "avoid" as const, strength: "soft" as const, categories: [], slots: [] }] : [];
}

export function voiceActionToIntentDelta(input: {
  action: VoiceTurnAction;
  currentOutfit: Outfit;
  wardrobe: WardrobeItem[];
  focusedSlot: OutfitSlot | null;
}): IntentDelta {
  const request = input.action.userRequest.trim();
  const semanticRequest = `${request} ${input.action.targetDescription ?? ""}`.trim();
  const preserveSlots = explicitlyPreservedSlots(request);
  const inferredTarget = inferVoiceTargetSlot(semanticRequest, input.action.targetSlot, input.focusedSlot);
  const target = inferredTarget && !preserveSlots.includes(inferredTarget) ? inferredTarget : null;
  const explicitRemoval = input.action.action === "remove" || /\b(remove|without|no|skip|take off|lose)\b/.test(request.toLowerCase());
  const emptySlots = explicitRemoval && target && ["outerwear", "bag", "jewelry", "extraAccessory"].includes(target) ? [target] : [];
  const targeted = Boolean(target) && (input.action.action === "revise" || input.action.action === "remove");
  return IntentDeltaSchema.parse({
    operation: targeted ? "targeted_revision" : "global_revision",
    targetSlots: target ? [target] : [],
    preserveSlots,
    emptySlots,
    requiredItemIds: requestedAvailableItemIds(request, input.wardrobe),
    excludedItemIds: [],
    excludedCategories: [],
    adjustments: { ...zeroAdjustments, ...adjustmentFor(request) },
    desiredStyleTags: [],
    undesiredStyleTags: [],
    temporaryRules: temporaryRulesFor(request),
    rawUtterance: request,
    confidence: 1,
    ambiguity: [],
  });
}

export function outfitMutationProof(before: Outfit | null, after: Outfit) {
  const slots = ["top", "bottom", "onePiece", "outerwear", "shoes", "bag", "jewelry", "extraAccessory"] as const;
  const changedSlots = slots.filter((slot) => before?.itemIds[slot] !== after.itemIds[slot]);
  const beforeIds = new Set(before ? Object.values(before.itemIds).filter((id): id is string => Boolean(id)) : []);
  const afterIds = new Set(Object.values(after.itemIds).filter((id): id is string => Boolean(id)));
  return {
    changedSlots,
    removedItemIds: [...beforeIds].filter((id) => !afterIds.has(id)),
    addedItemIds: [...afterIds].filter((id) => !beforeIds.has(id)),
  };
}
