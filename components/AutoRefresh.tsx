"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Reloads the page's data every so often while work is in progress, so progress shows
// without pressing refresh. Each reload also restarts the queue if it has paused.
export default function AutoRefresh({ seconds = 30, label = true }: { seconds?: number; label?: boolean }) {
  const router = useRouter();
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => {
      router.refresh();
      setAt(new Date());
    };
    const timer = setInterval(refresh, seconds * 1000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);
  if (!label) return null;
  return (
    <span className="text-xs text-muted" aria-live="off">
      Updates on its own · last checked {at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </span>
  );
}
