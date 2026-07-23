import { describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/cloud/supabase-client", () => ({
  getSupabaseClient: () => ({ auth: { signInWithOtp } }),
}));

import { sendMagicLink } from "@/lib/cloud/auth";

describe("cloud authentication", () => {
  it("sends a Magic Link to the supplied callback origin", async () => {
    await sendMagicLink("person@example.com", "https://yiyi.example.com");

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      options: { emailRedirectTo: "https://yiyi.example.com" },
    });
  });
});
