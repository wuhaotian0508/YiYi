import { describe, expect, it } from "vitest";
import { DailyIntentSchema, OutfitSchema, WardrobeItemSchema } from "@/domain/schemas";
import { demoIntent, demoWardrobe } from "@/mocks/wardrobe";

describe("canonical schemas", () => {
  it("accepts every demo wardrobe item", () => {
    expect(demoWardrobe.map((item) => WardrobeItemSchema.parse(item))).toHaveLength(demoWardrobe.length);
  });

  it("rejects unknown daily intent fields", () => {
    expect(() => DailyIntentSchema.parse({ ...demoIntent, invented: true })).toThrow();
  });

  it("requires either separates or one piece and always shoes", () => {
    expect(() => OutfitSchema.parse({ id: crypto.randomUUID(), itemIds: { top: demoWardrobe[3].id, bottom: demoWardrobe[6].id }, deterministicScore: 2 })).toThrow();
    expect(() => OutfitSchema.parse({ id: crypto.randomUUID(), itemIds: { onePiece: demoWardrobe[3].id, shoes: demoWardrobe[9].id }, deterministicScore: 2 })).not.toThrow();
  });
});
