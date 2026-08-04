"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getCloudSession, signOutCloud, subscribeToCloudAuth } from "@/lib/cloud/auth";
import { cloudConfiguration } from "@/lib/cloud/supabase-client";
import { bootstrapCloudSync } from "@/lib/cloud/sync";
import { CloudSignInForm } from "@/components/cloud/cloud-sign-in-form";

export function CloudSyncSettings() {
  const configuration = cloudConfiguration();
  const [session, setSession] = useState<Session | null>(null);

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

  async function signOut() {
    await signOutCloud();
    setSession(null);
  }

  return <section className="settings-privacy cloud-sync-settings">
    <h2>Cloud sync</h2>
    <p className="secondary-copy">Sign in to sync wardrobe details, preferences, and outfit history. Images stay on this device.</p>
    {session ? <div className="cloud-sync-account"><p>Signed in as {session.user.email ?? "your account"}</p><button className="secondary-button" onClick={() => void signOut()}>Sign out</button></div> : <CloudSignInForm />}
  </section>;
}
