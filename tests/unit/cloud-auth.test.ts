import { beforeEach, describe, expect, it, vi } from "vitest";

const { exchangeCodeForSession, setSession, signInWithOtp, verifyOtp } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/cloud/supabase-client", () => ({
  getSupabaseClient: () => ({ auth: { exchangeCodeForSession, setSession, signInWithOtp, verifyOtp } }),
}));

import { completeCloudSignIn, hasCloudCallbackParameters, rootCloudCallbackDestination, sendMagicLink } from "@/lib/cloud/auth";

const session = { user: { email: "person@example.com" } };

describe("cloud authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInWithOtp.mockResolvedValue({ error: null });
    exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });
    setSession.mockResolvedValue({ data: { session }, error: null });
    verifyOtp.mockResolvedValue({ data: { session }, error: null });
    window.history.replaceState({}, "", "/settings");
  });

  it("sends a Magic Link to the supplied callback origin", async () => {
    await sendMagicLink("person@example.com", "https://yiyi.example.com");

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      options: { emailRedirectTo: "https://yiyi.example.com" },
    });
  });

  it("redeems and removes a PKCE code callback", async () => {
    window.history.replaceState({}, "", "/settings?code=pkce-code&state=state-value");

    await expect(completeCloudSignIn()).resolves.toEqual({ status: "signed_in", session });
    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(window.location.pathname).toBe("/settings");
    expect(window.location.search).toBe("");
  });

  it("redeems a token-hash Magic Link callback", async () => {
    window.history.replaceState({}, "", "/settings?token_hash=hashed-token&type=email");

    expect(hasCloudCallbackParameters()).toBe(true);
    await expect(completeCloudSignIn()).resolves.toEqual({ status: "signed_in", session });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hashed-token", type: "email" });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("restores an implicit session callback and removes its tokens from the URL", async () => {
    window.history.replaceState({}, "", "/settings#access_token=access-value&refresh_token=refresh-value&expires_in=3600&token_type=bearer");

    expect(hasCloudCallbackParameters()).toBe(true);
    await expect(completeCloudSignIn()).resolves.toEqual({ status: "signed_in", session });
    expect(setSession).toHaveBeenCalledWith({ access_token: "access-value", refresh_token: "refresh-value" });
    expect(window.location.hash).toBe("");
  });

  it("rejects an incomplete implicit session without passing a token to Supabase", async () => {
    window.history.replaceState({}, "", "/settings#access_token=access-value");

    await expect(completeCloudSignIn()).resolves.toEqual({
      status: "failed",
      message: "That sign-in link returned an incomplete session. Request a new one.",
    });
    expect(setSession).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("reports an incomplete token-hash callback instead of treating it as signed out", async () => {
    window.history.replaceState({}, "", "/settings?token_hash=hashed-token");

    expect(hasCloudCallbackParameters()).toBe(true);
    await expect(completeCloudSignIn()).resolves.toEqual({
      status: "failed",
      message: "That sign-in link is incomplete. Request a new one.",
    });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("preserves a site-root callback for the sign-in route to redeem", () => {
    window.history.replaceState({}, "", "/?code=pkce-code&state=state-value");

    expect(rootCloudCallbackDestination("/")).toBe("/sign-in?code=pkce-code&state=state-value");
    expect(rootCloudCallbackDestination("/settings")).toBeNull();
  });
});
