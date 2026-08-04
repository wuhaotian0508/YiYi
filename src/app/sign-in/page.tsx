"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { YiYiMark } from "@/components/brand/yiyi-mark";
import { SecondaryButton } from "@/components/ui/buttons";
import { CloudSignInForm } from "@/components/cloud/cloud-sign-in-form";
import { getCloudSession, subscribeToCloudAuth } from "@/lib/cloud/auth";
import { cloudConfiguration } from "@/lib/cloud/supabase-client";
import { bootstrapCloudSync } from "@/lib/cloud/sync";
import { dismissCloudSignInPrompt } from "@/lib/storage/db";

/** Only same-site paths are honoured, so a crafted `next` cannot redirect off YiYi. */
function destinationFrom(search: string) {
  const next = new URLSearchParams(search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/today";
}

export default function SignInPage() {
  const router = useRouter();
  const destination = useRef("/today");

  useEffect(() => {
    const target = destinationFrom(window.location.search);
    destination.current = target;
    if (!cloudConfiguration().configured) { router.replace(target); return; }
    let active = true;
    void getCloudSession().then((session) => { if (active && session) router.replace(target); }).catch(() => undefined);
    const unsubscribe = subscribeToCloudAuth((event) => {
      if (!active || event !== "SIGNED_IN") return;
      void bootstrapCloudSync().catch(() => undefined);
      router.replace(target);
    });
    return () => { active = false; unsubscribe(); };
  }, [router]);

  async function skip() {
    await dismissCloudSignInPrompt();
    router.replace(destination.current);
  }

  return <main className="phone-page"><section className="page-column onboarding-screen">
    <div className="center-stage"><div>
      <YiYiMark size={78} />
      <h1 className="page-title setup-title">Keep YiYi with you.</h1>
      <p className="body-copy setup-copy">Sign in to sync wardrobe details, preferences, and outfit history across your devices. Images stay on this device.</p>
    </div></div>
    <div className="setup-actions">
      <CloudSignInForm />
      <SecondaryButton onClick={() => void skip()}>Not now</SecondaryButton>
    </div>
  </section></main>;
}
