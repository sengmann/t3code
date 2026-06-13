import { CheckIcon } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { updateProvidersInEnvironment } from "../environmentApi";
import { useLocalEnvironmentUpdateGroups } from "./ProviderUpdateLaunchNotification.environments";
import {
  collectProviderUpdateOutcomeSnapshots,
  firstRejectedProviderUpdateMessage,
  getProviderUpdateProgressToastView,
  getProviderUpdateSidebarPillView,
  resolveEnvironmentUpdateRowStatus,
  type LocalEnvironmentUpdateGroup,
  type ProviderUpdateRowStatus,
  type ProviderUpdateRowStatusKind,
  type ProviderUpdateToastView,
} from "./ProviderUpdateLaunchNotification.logic";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// If neither the dispatch result nor server state ever reports the update (e.g.
// the request never reached the backend), stop the spinner after this long so
// the row reverts to its Update button instead of spinning forever.
const PENDING_EXPIRY_MS = 20_000;

function rowToneClass(kind: ProviderUpdateRowStatusKind): string {
  switch (kind) {
    case "failed":
      return "text-destructive";
    case "unchanged":
      return "text-warning";
    case "success":
      return "text-success";
    default:
      return "text-muted-foreground";
  }
}

function EnvironmentUpdateRow({
  group,
  status,
  onUpdate,
}: {
  readonly group: LocalEnvironmentUpdateGroup;
  readonly status: ProviderUpdateRowStatus;
  readonly onUpdate: () => void;
}) {
  let trailing: ReactNode;
  switch (status.kind) {
    case "loading":
      trailing = <Spinner className="size-4 text-muted-foreground" />;
      break;
    case "success":
      trailing = <CheckIcon aria-hidden="true" className="size-4 text-success" />;
      break;
    case "failed":
    case "unchanged":
      trailing = (
        <Button size="xs" variant="outline" onClick={onUpdate}>
          Retry
        </Button>
      );
      break;
    default:
      trailing = (
        <Button size="xs" onClick={onUpdate}>
          Update
        </Button>
      );
      break;
  }

  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{group.label}</span>
        <span className={cn("truncate text-xs", rowToneClass(status.kind))}>{status.text}</span>
      </div>
      <div className="shrink-0">{trailing}</div>
    </div>
  );
}

/**
 * The launch popover's body when WSL is present: one row per local environment
 * (Windows + WSL), each with its own "update all" trigger that targets only
 * that environment's backend.
 */
export function ProviderUpdateEnvironmentRows({
  onInteract,
}: {
  /** Called the first time the user triggers an update, so the host can stop refreshing the prompt. */
  readonly onInteract?: () => void;
}) {
  const { groups } = useLocalEnvironmentUpdateGroups();
  const groupByEnvironment = useMemo(
    () => new Map(groups.map((group) => [group.environmentId, group] as const)),
    [groups],
  );

  // Only surface results that land after this popover opened.
  const visibleAfterIsoRef = useRef<string>(new Date().toISOString());

  const [pendingEnvironments, setPendingEnvironments] = useState<ReadonlySet<EnvironmentId>>(
    () => new Set(),
  );
  const [errorByEnvironment, setErrorByEnvironment] = useState<ReadonlyMap<EnvironmentId, string>>(
    () => new Map(),
  );
  const [resultByEnvironment, setResultByEnvironment] = useState<
    ReadonlyMap<EnvironmentId, ProviderUpdateToastView>
  >(() => new Map());

  const clearPending = useCallback((environmentId: EnvironmentId) => {
    setPendingEnvironments((previous) => {
      if (!previous.has(environmentId)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(environmentId);
      return next;
    });
  }, []);

  const handleUpdate = useCallback(
    async (environmentId: EnvironmentId) => {
      const group = groupByEnvironment.get(environmentId);
      if (!group || group.candidates.length === 0) {
        return;
      }
      onInteract?.();
      const providerCount = group.candidates.length;
      const targets = group.candidates.map((candidate) => ({
        driver: candidate.driver,
        instanceId: candidate.instanceId,
      }));

      setPendingEnvironments((previous) => new Set(previous).add(environmentId));
      setErrorByEnvironment((previous) => {
        if (!previous.has(environmentId)) {
          return previous;
        }
        const next = new Map(previous);
        next.delete(environmentId);
        return next;
      });
      setResultByEnvironment((previous) => {
        if (!previous.has(environmentId)) {
          return previous;
        }
        const next = new Map(previous);
        next.delete(environmentId);
        return next;
      });

      const expiry = setTimeout(() => clearPending(environmentId), PENDING_EXPIRY_MS);
      try {
        const results = await Promise.allSettled(
          updateProvidersInEnvironment(environmentId, targets),
        );
        if (results.length === 0) {
          setErrorByEnvironment((previous) =>
            new Map(previous).set(
              environmentId,
              "This environment isn’t connected — try again once it reconnects.",
            ),
          );
          return;
        }
        const rejectedMessage = firstRejectedProviderUpdateMessage(results);
        if (rejectedMessage) {
          setErrorByEnvironment((previous) =>
            new Map(previous).set(environmentId, rejectedMessage),
          );
          return;
        }
        const view = getProviderUpdateProgressToastView({
          providers: collectProviderUpdateOutcomeSnapshots(results),
          providerCount,
        });
        setResultByEnvironment((previous) => new Map(previous).set(environmentId, view));
      } catch (error) {
        setErrorByEnvironment((previous) =>
          new Map(previous).set(
            environmentId,
            error instanceof Error ? error.message : "Provider update failed.",
          ),
        );
      } finally {
        clearTimeout(expiry);
        clearPending(environmentId);
      }
    },
    [clearPending, groupByEnvironment, onInteract],
  );

  const rows = groups
    .map((group) => ({
      group,
      status: resolveEnvironmentUpdateRowStatus({
        group,
        error: errorByEnvironment.get(group.environmentId),
        result: resultByEnvironment.get(group.environmentId),
        pill: getProviderUpdateSidebarPillView(group.providers, {
          visibleAfterIso: visibleAfterIsoRef.current,
        }),
        isPending: pendingEnvironments.has(group.environmentId),
      }),
    }))
    .filter(({ group, status }) => group.candidates.length > 0 || status.kind !== "idle");

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="mt-0.5 flex flex-col gap-1">
      {rows.map(({ group, status }) => (
        <EnvironmentUpdateRow
          key={group.environmentId}
          group={group}
          status={status}
          onUpdate={() => handleUpdate(group.environmentId)}
        />
      ))}
    </div>
  );
}
