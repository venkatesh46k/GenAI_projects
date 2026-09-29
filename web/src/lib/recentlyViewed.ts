import { useEffect, useState } from "react";

const KEY = "recently-viewed-customers";
const MAX = 6;
const CHANGED = "recently-viewed-changed"; // same-tab components (the sidebar) need to hear about it too

/** Per-viewer convenience only: which customers this browser opened recently. Never read by the server. */
function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Call once when a customer page opens: moves it to the front, keeps the list short. */
export function recordRecentlyViewed(msisdn: string): void {
  try {
    const next = [msisdn, ...read().filter((item) => item !== msisdn)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    /* private browsing or a full quota: the shortcut just does not persist */
  }
}

/** The list, live-updated as the viewer opens more customers in this tab. */
export function useRecentlyViewed(): string[] {
  const [list, setList] = useState<string[]>(() => read());
  useEffect(() => {
    const onChange = () => setList(read());
    window.addEventListener(CHANGED, onChange);
    window.addEventListener("storage", onChange); // another tab changed it
    return () => {
      window.removeEventListener(CHANGED, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return list;
}
