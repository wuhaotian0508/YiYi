import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import TodayPage from "@/app/today/page";
import { db } from "@/lib/storage/db";

describe("Today live voice recovery", () => {
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_MODE", "live");
    vi.stubEnv("NEXT_PUBLIC_SEED_DEMO_WARDROBE", "true");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(() => null), length: 0 },
    });
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await db.delete();
  });

  it("releases a failed connection so the central Voice Dock can retry", async () => {
    let tokenRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/weather")) return new Response(null, { status: 503 });
      if (url.includes("/api/realtime/token")) {
        tokenRequests += 1;
        return new Response(JSON.stringify({ error: { message: "Unavailable" } }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<StrictMode><TodayPage /></StrictMode>);
    const dock = await screen.findByRole("button", { name: "Start live voice session" });
    await waitFor(() => expect(dock).toBeEnabled());
    fireEvent.click(dock);
    fireEvent.click(dock);
    await screen.findByText("YiYi couldn’t finish that.");
    expect(tokenRequests).toBe(1);
    expect(screen.queryByText("Listening…")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start live voice session" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Start live voice session" }));
    await waitFor(() => expect(tokenRequests).toBe(2));
  });
});
