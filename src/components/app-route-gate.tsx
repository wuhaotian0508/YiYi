"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { migrateLegacyOnboardingState } from "@/lib/storage/db";

const protectedRoots = ["/today", "/wardrobe", "/preferences", "/settings"];

function isProtectedRoute(pathname: string) {
  return protectedRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export function AppRouteGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const gated = pathname === "/" || isProtectedRoute(pathname);
  const [decision, setDecision] = useState<{ pathname: string; allowed: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!gated) return;
    void migrateLegacyOnboardingState().then((state) => {
      if (cancelled) return;
      if (pathname === "/" && state.status === "complete") {
        router.replace("/today");
        return;
      }
      if (isProtectedRoute(pathname) && state.status !== "complete") {
        router.replace("/");
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
