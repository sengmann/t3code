import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { readDesktopSecondaryBootstraps } from "./desktopLocal";

const DESKTOP_LOCAL_BOOTSTRAP_POLL_MS = 2_000;

function bootstrapsEqual(
  left: ReadonlyArray<DesktopEnvironmentBootstrap>,
  right: ReadonlyArray<DesktopEnvironmentBootstrap>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      entry.id === other.id &&
      entry.label === other.label &&
      entry.runningDistro === other.runningDistro &&
      entry.httpBaseUrl === other.httpBaseUrl &&
      entry.wsBaseUrl === other.wsBaseUrl &&
      entry.bootstrapToken === other.bootstrapToken
    );
  });
}

/**
 * Reactively track the desktop's secondary local backends (e.g. a parallel WSL
 * backend). The bridge exposes no change event, so each hook instance re-reads
 * on its own interval; a poll returns a fresh array, so the previous reference
 * is kept when the topology is unchanged to avoid re-rendering the consumer
 * every tick. Use this instead of polling the bridge ad hoc.
 */
export function useDesktopLocalBootstraps(): ReadonlyArray<DesktopEnvironmentBootstrap> {
  const [bootstraps, setBootstraps] = useState<ReadonlyArray<DesktopEnvironmentBootstrap>>(
    readDesktopSecondaryBootstraps,
  );

  useEffect(() => {
    const read = () => {
      const next = readDesktopSecondaryBootstraps();
      setBootstraps((previous) => (bootstrapsEqual(previous, next) ? previous : next));
    };
    read();
    const interval = setInterval(read, DESKTOP_LOCAL_BOOTSTRAP_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  return bootstraps;
}
