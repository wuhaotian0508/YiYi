import type { DailyIntent, OutfitSlot, WardrobeItem } from "@/domain/schemas";

export type SlotPolicy = "required" | "optional" | "discouraged" | "forbidden";
export type SituationKind = "everyday" | "court_sport" | "spectator_sport" | "gym" | "running" | "hiking" | "lab" | "interview" | "wedding" | "rain_commute" | "walking";

export type SituationProfile = {
  kind: SituationKind;
  intensity: "low" | "moderate" | "high";
  slotPolicy: Record<OutfitSlot, SlotPolicy>;
  segments: Array<{ label: string; timeOfDay: DailyIntent["activities"][number]["timeOfDay"]; kind: SituationKind }>;
};

const corePolicy: Record<OutfitSlot, SlotPolicy> = {
  top: "required",
  bottom: "required",
  onePiece: "optional",
  outerwear: "optional",
  shoes: "required",
  bag: "optional",
  jewelry: "optional",
  extraAccessory: "optional",
};

export function normalizeSituationProfile(intent: DailyIntent): SituationProfile {
  const text = `${intent.activities.map((activity) => activity.label).join(" ")} ${intent.freeformSummary}`.toLowerCase();
  const kindFor = (value: string): SituationKind => {
    const normalized = value.toLowerCase();
    if (/\b(watch(?:ing)?|attend(?:ing)?|spectat(?:e|ing)|fan)\b[^.]{0,35}\bbasketball\b|\bbasketball\b[^.]{0,30}\b(watch(?:ing)?|fan)\b/.test(normalized)) return "spectator_sport";
    if (/\bbasketball\b|\bvolleyball\b|\btennis\b|\bcourt sport\b/.test(normalized)) return "court_sport";
    if (/\bgym\b|\bworkout\b|\bweight(?:s|lifting)?\b|\btraining session\b/.test(normalized)) return "gym";
    if (/\brunning\b|\bjogging\b|\b5k\b|\bmarathon\b/.test(normalized)) return "running";
    if (/\bhik(?:e|ing)\b|\btrail\b/.test(normalized)) return "hiking";
    if (/\blab(?:oratory)?\b|\bchemistry practical\b/.test(normalized)) return "lab";
    if (/\binterview\b/.test(normalized)) return "interview";
    if (/\bwedding\b/.test(normalized)) return "wedding";
    if (/\brain(?:y)? commute\b|\bcommut(?:e|ing)\b.*\brain\b|\brain\b.*\bcommut(?:e|ing)\b/.test(normalized)) return "rain_commute";
    if (/\blots? of walking\b|\bwalking all day\b/.test(normalized)) return "walking";
    return "everyday";
  };
  const segments = intent.activities.map((activity) => ({ ...activity, kind: kindFor(activity.label) }));
  const profile = (kind: SituationKind, intensity: SituationProfile["intensity"], overrides: Partial<Record<OutfitSlot, SlotPolicy>> = {}): SituationProfile => ({
    kind,
    intensity,
    slotPolicy: { ...corePolicy, ...overrides },
    segments,
  });
  if (/\b(watch(?:ing)?|attend(?:ing)?|spectat(?:e|ing)|fan)\b[^.]{0,35}\bbasketball\b|\bbasketball\b[^.]{0,30}\b(watch(?:ing)?|fan)\b/.test(text)) return profile("spectator_sport", "low");
  if (/\bbasketball\b|\bvolleyball\b|\btennis\b|\bcourt sport\b/.test(text)) return profile("court_sport", "high", { bag: "forbidden", jewelry: "forbidden", extraAccessory: "forbidden" });
  if (/\bgym\b|\bworkout\b|\bweight(?:s|lifting)?\b|\btraining session\b/.test(text)) return profile("gym", "high", { bag: "forbidden", jewelry: "forbidden", extraAccessory: "forbidden" });
  if (/\brunning\b|\bjogging\b|\b5k\b|\bmarathon\b/.test(text)) return profile("running", "high", { bag: "forbidden", jewelry: "forbidden", extraAccessory: "forbidden" });
  if (/\bhik(?:e|ing)\b|\btrail\b/.test(text)) return profile("hiking", "high", { jewelry: "discouraged", extraAccessory: "discouraged" });
  if (/\blab(?:oratory)?\b|\bchemistry practical\b/.test(text)) return profile("lab", "moderate", { jewelry: "discouraged", extraAccessory: "discouraged" });
  if (/\binterview\b/.test(text)) return profile("interview", "low");
  if (/\bwedding\b/.test(text)) return profile("wedding", "low");
  if (/\brain(?:y)? commute\b|\bcommut(?:e|ing)\b.*\brain\b|\brain\b.*\bcommut(?:e|ing)\b/.test(text)) return profile("rain_commute", "moderate");
  if (intent.walkingIntensity >= 4 || /\blots? of walking\b|\bwalking all day\b/.test(text)) return profile("walking", "moderate");
  return profile("everyday", "low");
}

function semanticText(item: WardrobeItem) {
  return [item.subtype, ...item.styleTags, ...item.occasionTags, ...item.weatherTags].join(" ").toLowerCase();
}

export function situationItemViolation(item: WardrobeItem, slot: OutfitSlot, profile: SituationProfile): string | null {
  if (profile.slotPolicy[slot] === "forbidden") return `SITUATION_SLOT_FORBIDDEN:${slot}`;
  if (item.category !== "shoes") return null;
  const text = semanticText(item);
  if (["court_sport", "gym", "running"].includes(profile.kind)) {
    if (item.comfort < 3 || !/sneaker|trainer|running|athletic|sport|court/.test(text)) return "ACTIVITY_FOOTWEAR_UNSAFE";
  }
  if (profile.kind === "hiking" && (item.comfort < 3 || !/boot|hiking|trail|sneaker|trainer/.test(text))) return "ACTIVITY_FOOTWEAR_UNSAFE";
  if (profile.kind === "lab" && /sandal|slide|open[ -]?toe|mule|flip[ -]?flop/.test(text)) return "LAB_FOOTWEAR_UNSAFE";
  return null;
}
