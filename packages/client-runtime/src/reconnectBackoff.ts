import * as Duration from "effect/Duration";
import * as Option from "effect/Option";

/**
 * Configuration for exponential reconnect backoff.
 */
export interface ReconnectBackoffConfig {
  /** Base delay before the first retry. */
  readonly initialDelay: Duration.Input;
  /** Multiplier applied per retry (exponential factor). */
  readonly backoffFactor: number;
  /** Hard upper bound on delay. */
  readonly maxDelay: Duration.Input;
  /** Maximum number of retries (0-based). `Option.none()` means unlimited. */
  readonly maxRetries: Option.Option<number>;
}

/**
 * Sensible defaults for WebSocket reconnect backoff.
 *
 * - 1 s initial delay, doubling each retry, capped at 64 s, up to 7 retries.
 */
export const DEFAULT_RECONNECT_BACKOFF: ReconnectBackoffConfig = {
  initialDelay: Duration.seconds(1),
  backoffFactor: 2,
  maxDelay: Duration.seconds(64),
  maxRetries: Option.some(7),
};

/**
 * Calculate the reconnect delay for a given retry index using exponential
 * backoff. Returns `Option.none()` when `retryIndex` exceeds the configured
 * maximum.
 */
export function getReconnectDelay(
  retryIndex: number,
  config: ReconnectBackoffConfig = DEFAULT_RECONNECT_BACKOFF,
): Option.Option<Duration.Duration> {
  if (!Number.isInteger(retryIndex) || retryIndex < 0) {
    return Option.none();
  }

  if (Option.isSome(config.maxRetries) && retryIndex >= config.maxRetries.value) {
    return Option.none();
  }

  const initialDelayMs = Duration.toMillis(Duration.fromInputUnsafe(config.initialDelay));
  const maxDelayMs = Duration.toMillis(Duration.fromInputUnsafe(config.maxDelay));

  return Option.some(
    Duration.millis(
      Math.min(Math.round(initialDelayMs * config.backoffFactor ** retryIndex), maxDelayMs),
    ),
  );
}

/**
 * Compatibility wrapper for UI surfaces that still display reconnect delays in
 * milliseconds.
 */
export function getReconnectDelayMs(
  retryIndex: number,
  config: ReconnectBackoffConfig = DEFAULT_RECONNECT_BACKOFF,
): number | null {
  return Option.match(getReconnectDelay(retryIndex, config), {
    onNone: () => null,
    onSome: Duration.toMillis,
  });
}
