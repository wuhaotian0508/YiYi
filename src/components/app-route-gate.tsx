"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { migrateLegacyOnboardingState } from "@/lib/storage/db";

const protectedRoots = ["/today", "/wardrobe", "/preferences", "/settings"];

function isProtectedRoute(pathname: string) {
  return protectedRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/**
 * Loaded on demand so the Supabase client stays out of every route's initial
 * bundle. Without a configured URL the import never happens at all, matching
 * how db.ts defers its cloud sync import.
 */
async function cloudSignInPromptWanted() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return false;
  const { shouldPromptCloudSignIn } = await import("@/lib/cloud/sign-in-prompt");
  return shouldPromptCloudSignIn();
}

export function AppRouteGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const gated = pathname === "/" || isProtectedRoute(pathname);
  const [decision, setDecision] = useState<{ pathname: string; allowed: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!gated) return;
    void migrateLegacyOnboardingState().then(async (state) => {
      if (cancelled) return;
      if (isProtectedRoute(pathname) && state.status !== "complete") {
        router.replace("/");
        return;
      }
      if (state.status === "complete" && await cloudSignInPromptWanted()) {
        if (cancelled) return;
        router.replace(`/sign-in?next=${encodeURIComponent(pathname === "/" ? "/today" : pathname)}`);
        return;
      }
      if (cancelled) return;
      if (pathname === "/" && state.status === "complete") {
        router.replace("/today");
        return;
      }
      setDecision({ pathname, allowed: true });
    }).catch(() => {
      if (cancelled) return;
      if (isProtectedRoute(pathname)) router.replace("/");
      else setDecision({ pathname, allowed: true });
    });
    return () => { cancelled = true; };
  }, [gated, pathname, router]);

  if (!gated) return children;
  return decision?.pathname === pathname && decision.allowed ? children : null;
}
