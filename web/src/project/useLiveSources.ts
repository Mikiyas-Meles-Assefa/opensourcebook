import { useEffect, useRef } from "react";
import type { Source } from "../api/types";

/** How often the sources of a project opened from a folder are looked at while it is open and shown. */
export const LIVE_MS = 3_000;

/**
 * Keeps a project's source list in step with its linked folder while the project is open: the launcher has the engine
 * check the folder when its files change, and this looks at the list every few seconds (and when the tab is shown) and
 * puts the new one on screen only when it differs. Nothing is marked new; the list just changes.
 */
export function useLiveSources(folder: string | undefined, current: readonly Source[] | undefined, load: () => Promise<Source[]>, set: (sources: Source[]) => void): void {
  const known = useRef<string | undefined>(undefined);
  const loadRef = useRef(load);
  const setRef = useRef(set);
  useEffect(() => {
    known.current = current ? JSON.stringify(current) : undefined;
    loadRef.current = load;
    setRef.current = set;
  });
  const ready = current !== undefined;
  useEffect(() => {
    if (!folder || !ready) return;
    let stopped = false;
    let looking = false;
    const look = async () => {
      if (stopped || looking || document.visibilityState === "hidden") return;
      looking = true;
      try {
        const fresh = await loadRef.current();
        if (!stopped && JSON.stringify(fresh) !== known.current) setRef.current(fresh);
      } catch {
        // The next look tries again; the engine may be restarting.
      } finally {
        looking = false;
      }
    };
    const timer = window.setInterval(() => void look(), LIVE_MS);
    const shown = () => void look();
    document.addEventListener("visibilitychange", shown);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [folder, ready]);
}
