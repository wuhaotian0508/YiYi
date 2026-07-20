import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomSheet } from "@/components/ui/bottom-sheet";

vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("motion/react")>(),
  useReducedMotionConfig: () => true,
}));

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("BottomSheet lifecycle", () => {
  it("locks page scrolling, focuses the first control, and restores both on cleanup", async () => {
    const before = document.createElement("button");
    before.textContent = "Before";
    document.body.append(before);
    before.focus();

    const onClose = vi.fn();
    const { unmount } = render(<BottomSheet open onClose={onClose} label="Intent editor"><button>Update outfit</button></BottomSheet>);

    expect(screen.getByRole("dialog", { name: "Intent editor" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(screen.getByRole("button", { name: "Update outfit" })).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(before).toHaveFocus();
    before.remove();
  });

  it("offers direct close controls when motion is reduced", () => {
    const onClose = vi.fn();
    render(<BottomSheet open onClose={onClose} label="Preference editor"><button>Done</button></BottomSheet>);

    fireEvent.click(screen.getByRole("button", { name: "Close Preference editor" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
