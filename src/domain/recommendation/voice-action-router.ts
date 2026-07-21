import { IntentDeltaSchema, type IntentDelta, type Outfit, type OutfitSlot, type WardrobeItem } from "@/domain/schemas";
import type { VoiceTurnAction } from "@/lib/realtime/voice-session";

const zeroAdjustments = { formality: 0, warmth: 0, comfort: 0, colorfulness: 0, walkingPriority: 0, layering: 0, structure: 0 };

export function inferVoiceTargetSlot(request: string, explicit: OutfitSlot | null, focused: OutfitSlot | null): OutfitSlot | null {
  if (explicit) return explicit;
  const text = request.toLowerCase();
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
    formality: /more formal|dressier|polished/.test(text) ? 0.6 : /less formal|casual|relaxed/.test(text) ? -0.6 : 0,
    warmth: /warmer|cold/.test(text) ? 0.7 : /cooler|too warm|hot/.test(text) ? -0.7 : 0,
    comfort: /comfortable|comfort|relaxed|walking|hiking|running|gym|basketball/.test(text) ? 0.7 : 0,
    colorfulness: /more colou?r|brighter/.test(text) ? 0.6 : /less colou?r|neutral/.test(text) ? -0.6 : 0,
    walkingPriority: /walking|hiking|running|gym|basketball/.test(text) ? 1 : 0,
    layering: /layer|jacket|coat/.test(text) ? 0.4 : 0,
    structure: /structured|tailored/.test(text) ? 0.5 : /soft|relaxed/.test(text) ? -0.4 : 0,
  };
}

function requestedAvailableItemIds(request: string, wardrobe: WardrobeItem[]) {
  const text = request.toLowerCase();
  const matches = wardrobe.filter((item) => {
    if (item.availability !== "available") return false;
    const phrases = [item.subtype, item.primaryColor, `${item.primaryColor} ${item.subtype}`, ...item.styleTags].map((value) => value.toLowerCase());
    return phrases.some((phrase) => phrase.length >= 4 && text.includes(phrase));
  });
  return matches.length === 1 ? [matches[0].id] : [];
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
    temporaryRules: [],
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
