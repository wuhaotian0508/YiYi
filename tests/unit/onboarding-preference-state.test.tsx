import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirstRunPage from "@/app/page";
import type { PreferenceProfile } from "@/domain/schemas";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const storage = vi.hoisted(() => ({
  requestPersistentStorage: vi.fn(async () => ({ persisted: false, usage: 0, quota: 0 })),
  savePreferences: vi.fn<(profile: PreferenceProfile) => Promise<void>>(async () => undefined),
  seedWardrobe: vi.fn(async (): Promise<void> => undefined),
  setExperienceMode: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/storage/db", () => storage);
vi.mock("@/lib/audio/sound-system", () => ({ unlockSounds: vi.fn(async () => undefined) }));
vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("motion/react")>(),
  useReducedMotionConfig: () => true,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function clickAndWait(buttonName: string | RegExp, nextText: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
  await screen.findByText(nextText);
}

async function reachPermission() {
  await clickAndWait("Begin", "How YiYi helps");
  await clickAndWait("Skip", "YiYi is built around live voice.");
}

async function reachFineTune() {
  render(<FirstRunPage />);
  await reachPermission();
  await clickAndWait("Allow Microphone", "How would you describe your wardrobe?");
  await clickAndWait("Continue", "Your taste");
  await clickAndWait("Finish for now", "Fine-tune YiYi");
}

async function reachSetup() {
  await reachFineTune();
  await clickAndWait("Review my style", "Your style so far");
  await clickAndWait("Looks right", "Make it yours.");
}

describe("onboarding preference persistence boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "mock");
    const stored = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => stored.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => stored.set(key, value)),
        removeItem: vi.fn((key: string) => stored.delete(key)),
        clear: vi.fn(() => stored.clear()),
        key: vi.fn((index: number) => [...stored.keys()][index] ?? null),
        get length() { return stored.size; },
      },
    });
    storage.savePreferences.mockResolvedValue(undefined);
    storage.setExperienceMode.mockResolvedValue(undefined);
    storage.seedWardrobe.mockResolvedValue(undefined);
    storage.requestPersistentStorage.mockResolvedValue({ persisted: false, usage: 0, quota: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("exposes the selected wardrobe description as a pressed control", async () => {
    render(<FirstRunPage />);
    await reachPermission();
    await clickAndWait("Allow Microphone", "How would you describe your wardrobe?");

    const neutral = screen.getByRole("button", { name: "No labelUse the clothes I add without a wardrobe label." });
    const mixed = screen.getByRole("button", { name: "Mix bothMy wardrobe moves across both directions." });
    expect(neutral).toHaveAttribute("aria-pressed", "true");
    expect(mixed).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(mixed);
    expect(neutral).toHaveAttribute("aria-pressed", "false");
    expect(mixed).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps calibration navigation locked until a preference write finishes, then preserves explicit signals through Edit", async () => {
    const firstWrite = deferred<void>();
    storage.savePreferences.mockImplementationOnce(() => firstWrite.promise).mockResolvedValue(undefined);
    await reachFineTune();

    fireEvent.click(screen.getByRole("button", { name: "Relaxed tailoring" }));
    await waitFor(() => expect(storage.savePreferences).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    firstWrite.resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: "Review my style" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Relaxed tailoring" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText("Your taste");
    fireEvent.click(screen.getByRole("button", { name: "B feels like me" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish for now" }));
    await screen.findByText("Fine-tune YiYi");
    fireEvent.click(screen.getByRole("button", { name: "Review my style" }));

    const moreSection = (await screen.findByRole("heading", { name: "More of" })).closest("section");
    expect(moreSection).not.toBeNull();
    expect(within(moreSection!).getByText("Polished tailoring")).toBeVisible();
    expect(within(moreSection!).getByText("Relaxed tailoring")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
    await screen.findByText("Make it yours.");
    fireEvent.click(screen.getByRole("button", { name: "Add my clothes" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/wardrobe/add"));
    const finalProfile = storage.savePreferences.mock.calls.at(-1)?.[0];
    const activeLabels = finalProfile?.preferenceSignals?.filter((signal) => signal.status === "active").map((signal) => signal.label);
    expect(activeLabels).toEqual(expect.arrayContaining(["Polished tailoring", "Relaxed tailoring"]));
  });

  it("restores the previous answer when undoing an edited comparison", async () => {
    render(<FirstRunPage />);
    await reachPermission();
    await clickAndWait("Allow Microphone", "How would you describe your wardrobe?");
    await clickAndWait("Continue", "Your taste");

    fireEvent.click(screen.getByRole("button", { name: "B feels like me" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish for now" }));
    await screen.findByText("Fine-tune YiYi");
    fireEvent.click(screen.getByRole("button", { name: "Review my style" }));
    await screen.findByText("Your style so far");
    fireEvent.click(screen.getByRole("button", { name: "Edit comparisons" }));
    expect(await screen.findByRole("button", { name: "B feels like me" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "A feels like me" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish for now" }));
    await screen.findByText("Fine-tune YiYi");
    fireEvent.click(screen.getByRole("button", { name: "Review my style" }));
    await screen.findByText("Your style so far");
    fireEvent.click(screen.getByRole("button", { name: "Undo last answer" }));

    expect(await screen.findByRole("button", { name: "B feels like me" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "A feels like me" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the user on Fine-tune and blocks review when a preference write fails", async () => {
    storage.savePreferences.mockRejectedValueOnce(new Error("IndexedDB write failed"));
    await reachFineTune();

    fireEvent.click(screen.getByRole("button", { name: "Relaxed tailoring" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That preference wasn’t saved. Try again before continuing.");
    expect(screen.getByRole("button", { name: "Review my style" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Relaxed tailoring" })).toHaveAttribute("aria-pressed", "false");
  });

  it("allows only one setup completion at a time even when both choices are tapped rapidly", async () => {
    const modeWrite = deferred<void>();
    storage.setExperienceMode.mockImplementationOnce(() => modeWrite.promise);
    await reachSetup();

    fireEvent.click(screen.getByRole("button", { name: "Try the example wardrobe" }));
    fireEvent.click(screen.getByRole("button", { name: "Add my clothes" }));

    await waitFor(() => expect(storage.setExperienceMode).toHaveBeenCalledTimes(1));
    expect(storage.setExperienceMode).toHaveBeenCalledWith("demo", true);
    expect(screen.getByRole("button", { name: "Saving setup…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add my clothes" })).toBeDisabled();

    modeWrite.resolve();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/today"));
    expect(storage.seedWardrobe).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable setup persistence failure without marking onboarding complete", async () => {
    storage.savePreferences.mockRejectedValueOnce(new Error("quota exceeded"));
    await reachSetup();

    fireEvent.click(screen.getByRole("button", { name: "Add my clothes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Setup wasn’t saved. Your choices are still here — try again.");
    expect(localStorage.getItem("yiyi:onboarding-complete")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add my clothes" })).toBeEnabled();

    storage.savePreferences.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Add my clothes" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/wardrobe/add"));
    expect(localStorage.getItem("yiyi:onboarding-complete")).toBe("true");
  });
});
