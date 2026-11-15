"use client";

import dynamic from "next/dynamic";

// The coach uses camera, screen share, Web Workers, speech and localStorage,
// so it only ever renders in the browser.
const Coach = dynamic(() => import("@/components/Coach"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Loading…</div>
  ),
});

export function CoachLoader() {
  return <Coach />;
}
