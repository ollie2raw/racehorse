import { useEffect, useState } from "react";

export const DEBUG_FORCE_ANIM = true;

export function useEnterAnimation(durationMs = 300) {
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    setEntering(true);
    const timer = window.setTimeout(() => setEntering(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs]);

  return entering;
}
