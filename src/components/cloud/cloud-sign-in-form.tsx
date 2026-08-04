"use client";

import { useId, useState } from "react";
import { sendMagicLink } from "@/lib/cloud/auth";

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

  async function requestLink() {
    setSending(true);
    try {
      await sendMagicLink(email, `${window.location.origin}${window.location.pathname}`);
      setMessage("Check your email for a sign-in link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send a sign-in link.");
    } finally {
      setSending(false);
    }
  }

  return <div className="cloud-sync-form">
    <label htmlFor={inputId}>{label}</label>
    <input id={inputId} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
    <button className="secondary-button" disabled={sending} onClick={() => void requestLink()}>{sending ? "Sending…" : action}</button>
    {message && <p className="secondary-copy" role="status">{message}</p>}
  </div>;
}
