"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { completeCloudSignIn, getCloudSession, signOutCloud, subscribeToCloudAuth } from "@/lib/cloud/auth";
import { cloudConfiguration } from "@/lib/cloud/supabase-client";
import { bootstrapCloudSync } from "@/lib/cloud/sync";
import { CloudSignInForm } from "@/components/cloud/cloud-sign-in-form";

export function CloudSyncSettings() {
  const configuration = cloudConfiguration();
  const [session, setSession] = useState<Session | null>(null);
  const [callbackError, setCallbackError] = useState("");

  useEffect(() => {
    if (!configuration.configured) return;
    let active = true;
    void completeCloudSignIn().then(async (outcome) => {
      if (!active) return;
      if (outcome.status === "failed") setCallbackError(outcome.message);
      setSession(outcome.status === "signed_in" ? outcome.session : await getCloudSession());
    }).catch(() => undefined);
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

  async function signOut() {
    await signOutCloud();
    setSession(null);
  }

  return <section className="settings-privacy cloud-sync-settings">
    <h2>Cloud sync</h2>
    <p className="secondary-copy">Sign in to sync wardrobe details, preferences, and outfit history. Images stay on this device.</p>
    {callbackError && <p className="secondary-copy" role="alert">That sign-in link didn’t work: {callbackError}</p>}
    {session ? <div className="cloud-sync-account"><p>Signed in as {session.user.email ?? "your account"}</p><button className="secondary-button" onClick={() => void signOut()}>Sign out</button></div> : <CloudSignInForm />}
  </section>;
}
