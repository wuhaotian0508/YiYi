"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getCloudSession, sendMagicLink, signOutCloud, subscribeToCloudAuth } from "@/lib/cloud/auth";
import { cloudConfiguration } from "@/lib/cloud/supabase-client";
import { bootstrapCloudSync } from "@/lib/cloud/sync";

export function CloudSyncSettings() {
  const configuration = cloudConfiguration();
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!configuration.configured) return;
    let active = true;
    void getCloudSession().then((current) => { if (active) setSession(current); }).catch(() => undefined);
    const unsubscribe = subscribeToCloudAuth((event, current) => {
      if (!active) return;
      setSession(current);
      if (event === "SIGNED_IN") void bootstrapCloudSync().catch(() => undefined);
    });
    return () => { active = false; unsubscribe(); };
  }, [configuration.configured]);

  if (!configuration.configured) {
    return <section className="settings-privacy"><h2>Cloud sync</h2><p className="secondary-copy">Cloud sync is not configured. YiYi still works locally on this device.</p></section>;
  }

  async function requestLink() {
    try {
      await sendMagicLink(email, window.location.origin);
      setMessage("Check your email for a sign-in link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send a sign-in link.");
    }
  }

  async function signOut() {
    await signOutCloud();
    setSession(null);
    setMessage("");
  }

  return <section className="settings-privacy cloud-sync-settings">
    <h2>Cloud sync</h2>
    <p className="secondary-copy">Sign in to sync wardrobe details, preferences, and outfit history. Images stay on this device.</p>
    {session ? <div className="cloud-sync-account"><p>Signed in as {session.user.email ?? "your account"}</p><button className="secondary-button" onClick={() => void signOut()}>Sign out</button></div> : <div className="cloud-sync-form">
      <label htmlFor="cloud-sync-email">Email address</label>
      <input id="cloud-sync-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
      <button className="secondary-button" onClick={() => void requestLink()}>Email me a sign-in link</button>
    </div>}
    {message && <p className="secondary-copy" role="status">{message}</p>}
  </section>;
}
