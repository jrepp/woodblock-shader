import { useEffect } from "react";

export default function usePbpDebugBridge(pbpDebugRef) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.__pbpDebug = {
      getBufferSummary: () => pbpDebugRef.current?.getBufferSummary?.(),
      getBuffers: () => pbpDebugRef.current?.getBuffers?.(),
      stamp: (payload) => pbpDebugRef.current?.stamp?.(payload),
      step: (count) => pbpDebugRef.current?.step?.(count),
      setPigmentId: (id) => pbpDebugRef.current?.setPigmentId?.(id),
      resetLoad: () => pbpDebugRef.current?.resetLoad?.(),
    };
    return () => {
      delete window.__pbpDebug;
    };
  }, [pbpDebugRef]);
}
