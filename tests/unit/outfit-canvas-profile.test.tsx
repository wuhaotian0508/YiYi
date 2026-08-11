import { Profiler, type ProfilerOnRenderCallback } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutfitCanvas } from "@/components/outfit/outfit-canvas";
import { OutfitSchema } from "@/domain/schemas";
import { demoWardrobe } from "@/mocks/wardrobe";

vi.mock("@/components/wardrobe/garment", () => ({ Garment: ({ item, eager }: { item: { id: string }; eager?: boolean }) => <span data-profile-garment={item.id} data-profile-eager={eager ? "true" : "false"} /> }));
vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("motion/react")>(),
  useReducedMotionConfig: () => true,
}));

afterEach(cleanup);

describe("OutfitCanvas React profile", () => {
  it("selects a composition template from the outfit structure", () => {
    const separates = OutfitSchema.parse({ id: crypto.randomUUID(), itemIds: { top: demoWardrobe[2].id, bottom: demoWardrobe[5].id, shoes: demoWardrobe[8].id }, deterministicScore: 80 });
    const onePieceItem = { ...demoWardrobe[2], id: crypto.randomUUID(), category: "one_piece" as const, subtype: "Dress" };
    const onePiece = OutfitSchema.parse({ id: crypto.randomUUID(), itemIds: { onePiece: onePieceItem.id, shoes: demoWardrobe[8].id }, deterministicScore: 80 });
    const wardrobe = [...demoWardrobe, onePieceItem];
    const view = render(<OutfitCanvas outfit={separates} wardrobe={wardrobe} />);

    expect(view.container.querySelector(".outfit-canvas")).toHaveAttribute("data-template", "separates");
    view.rerender(<OutfitCanvas outfit={onePiece} wardrobe={wardrobe} />);
    expect(view.container.querySelector(".outfit-canvas")).toHaveAttribute("data-template", "one-piece");
  });

  it("lets the actual garment slot own revision emphasis", () => {
    const outfit = OutfitSchema.parse({ id: crypto.randomUUID(), itemIds: { top: demoWardrobe[2].id, bottom: demoWardrobe[5].id, shoes: demoWardrobe[8].id }, deterministicScore: 80 });
    const view = render(<OutfitCanvas outfit={outfit} wardrobe={demoWardrobe} emphasizedSlot="shoes" />);
    expect(view.container.querySelector('[data-slot="shoes"]')).toHaveAttribute("data-emphasized", "true");
    expect(view.container.querySelector('[data-slot="top"]')).not.toHaveAttribute("data-emphasized");
  });

  it("loads the visible recommendation garments without lazy-loading the LCP candidate", () => {
    const outfit = OutfitSchema.parse({ id: crypto.randomUUID(), itemIds: { top: demoWardrobe[2].id, bottom: demoWardrobe[5].id, shoes: demoWardrobe[8].id }, deterministicScore: 80 });
    const view = render(<OutfitCanvas outfit={outfit} wardrobe={demoWardrobe} />);
    expect([...view.container.querySelectorAll("[data-profile-garment]")]).toHaveLength(3);
    expect([...view.container.querySelectorAll('[data-profile-eager="true"]')]).toHaveLength(3);
  });

  it("commits a targeted replacement as one bounded update", () => {
    const records: { phase: string; actualDuration: number; baseDuration: number }[] = [];
    const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration, baseDuration) => records.push({ phase, actualDuration, baseDuration });
    const initial = OutfitSchema.parse({ id: "98888888-8888-4888-8888-888888888881", itemIds: { top: demoWardrobe[2].id, bottom: demoWardrobe[5].id, shoes: demoWardrobe[8].id, bag: demoWardrobe[10].id }, deterministicScore: 80 });
    const revised = OutfitSchema.parse({ ...initial, id: "98888888-8888-4888-8888-888888888882", itemIds: { ...initial.itemIds, shoes: demoWardrobe[9].id } });
    const view = render(<Profiler id="outfit-canvas" onRender={onRender}><OutfitCanvas outfit={initial} wardrobe={demoWardrobe} /></Profiler>);
    view.rerender(<Profiler id="outfit-canvas" onRender={onRender}><OutfitCanvas outfit={revised} wardrobe={demoWardrobe} /></Profiler>);

    if (process.env.YIYI_PRINT_PROFILE === "true") console.log(JSON.stringify(records, null, 2));
    expect(records.map((record) => record.phase)).toEqual(["mount", "update"]);
    expect(view.container.querySelectorAll("[data-profile-garment]")).toHaveLength(4);
    expect(view.container.querySelector(`[data-profile-garment="${demoWardrobe[9].id}"]`)).not.toBeNull();
    expect(view.container.querySelector(`[data-profile-garment="${demoWardrobe[8].id}"]`)).toBeNull();
  });
});
