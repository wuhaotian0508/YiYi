"use client";

import { useId, useState } from "react";
import { sendMagicLink, signInWithGoogle } from "@/lib/cloud/auth";

function safeDestination(search: string) {
  const next = new URLSearchParams(search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : null;
}

export function cloudSignInRedirectUrl(href: string) {
  const current = new URL(href);
  const redirect = new URL("/sign-in", current.origin);
  const destination = current.pathname === "/sign-in" ? safeDestination(current.search) : current.pathname;
  if (destination && destination !== "/sign-in") redirect.searchParams.set("next", destination);
  return redirect.toString();
}

function GoogleGlyph() {
  return <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z" />
    <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.6-3.8-12.3-9H4.4v5.7C8 41.1 15.4 46 24 46z" />
    <path fill="#FBBC05" d="M11.7 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.4C2.9 17.1 2 20.4 2 24s.9 6.9 2.4 9.9l7.3-5.7z" />
    <path fill="#EA4335" d="M24 10.4c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 3.9 29.9 2 24 2 15.4 2 8 6.9 4.4 14.1l7.3 5.7c1.7-5.2 6.6-9.4 12.3-9.4z" />
  </svg>;
}

/**
 * The Magic Link returns to the page that sent it. Both entry points mount a
 * Supabase client on load, which is what completes the PKCE code exchange, so
 * the redirect must never point at a route that does not.
 */
export function CloudSignInForm({ label = "Email address", action = "Email me a sign-in link" }: { label?: string; action?: string }) {
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [connecting, setConnecting] = useState(false);

  /** A successful handoff navigates to Google, so the button stays disabled. */
  async function continueWithGoogle() {
    setConnecting(true);
    setMessage("");
    try {
      await signInWithGoogle(cloudSignInRedirectUrl(window.location.href));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to continue with Google.");
      setConnecting(false);
    }
  }

  async function requestLink() {
    setSending(true);
    try {
      await sendMagicLink(email, cloudSignInRedirectUrl(window.location.href));
      setMessage("Check your email for a sign-in link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send a sign-in link.");
    } finally {
      setSending(false);
    }
  }

  return <div className="cloud-sync-form">
    <button className="secondary-button cloud-provider-button" disabled={connecting} onClick={() => void continueWithGoogle()}>
      <GoogleGlyph />
      {connecting ? "Opening Google…" : "Continue with Google"}
    </button>
    <p className="cloud-sync-divider"><span>or</span></p>
    <label htmlFor={inputId}>{label}</label>
    <input id={inputId} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
    <button className="secondary-button" disabled={sending} onClick={() => void requestLink()}>{sending ? "Sending…" : action}</button>
    {message && <p className="secondary-copy" role="status">{message}</p>}
  </div>;
}
