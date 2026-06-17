import { useEffect, useState } from "react";

export function useMediaQuery(query: string) {
  // Initialize from the actual match so the first paint uses the correct layout
  // (no mobile→desktop flash on load). window always exists in this client-only SPA.
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return matches;
}
