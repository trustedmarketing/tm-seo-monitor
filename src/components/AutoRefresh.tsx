"use client";

// components/AutoRefresh.tsx — re-render the page while work is in flight.
//
// WO-004. A <meta http-equiv="refresh"> inside a component body is not reliably
// hoisted into <head> by the App Router, so the page sat on "Generating…"
// indefinitely. This does it properly: refresh the server component tree on an
// interval, and stop when the caller says there is nothing left to wait for.
//
// router.refresh() rather than location.reload(): it refetches server data
// without discarding scroll position or anything typed into a caption box that
// has not been saved.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ seconds = 20, active }: { seconds?: number; active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [active, seconds, router]);

  return null;
}
