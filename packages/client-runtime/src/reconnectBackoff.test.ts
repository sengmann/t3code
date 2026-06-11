import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";

import {
  DEFAULT_RECONNECT_BACKOFF,
  getReconnectDelay,
  getReconnectDelayMs,
  type ReconnectBackoffConfig,
} from "./reconnectBackoff.ts";

function assertDelayMs(delay: Option.Option<Duration.Duration>, expectedMs: number) {
  if (Option.isNone(delay)) {
    assert.fail("Expected reconnect delay to be present");
  }
  assert.strictEqual(Duration.toMillis(delay.value), expectedMs);
}

describe("getReconnectDelay", () => {
  it("returns exponential delays with default config", () => {
    assertDelayMs(getReconnectDelay(0), 1_000);
    assertDelayMs(getReconnectDelay(1), 2_000);
    assertDelayMs(getReconnectDelay(2), 4_000);
    assertDelayMs(getReconnectDelay(3), 8_000);
    assertDelayMs(getReconnectDelay(4), 16_000);
    assertDelayMs(getReconnectDelay(5), 32_000);
    assertDelayMs(getReconnectDelay(6), 64_000);
  });

  it("returns none when retry index exceeds maxRetries", () => {
    assert.strictEqual(Option.isNone(getReconnectDelay(7)), true);
    assert.strictEqual(Option.isNone(getReconnectDelay(100)), true);
  });

  it("returns none for negative indices", () => {
    assert.strictEqual(Option.isNone(getReconnectDelay(-1)), true);
  });

  it("returns none for non-integer indices", () => {
    assert.strictEqual(Option.isNone(getReconnectDelay(1.5)), true);
  });

  it("caps delay at maxDelay", () => {
    const config: ReconnectBackoffConfig = {
      initialDelay: Duration.seconds(10),
      backoffFactor: 10,
      maxDelay: Duration.seconds(30),
      maxRetries: Option.some(5),
    };

    assertDelayMs(getReconnectDelay(0, config), 10_000);
    assertDelayMs(getReconnectDelay(1, config), 30_000);
    assertDelayMs(getReconnectDelay(2, config), 30_000);
  });

  it("supports unlimited retries when maxRetries is none", () => {
    const config: ReconnectBackoffConfig = {
      ...DEFAULT_RECONNECT_BACKOFF,
      maxRetries: Option.none(),
    };

    assertDelayMs(getReconnectDelay(0, config), 1_000);
    assertDelayMs(getReconnectDelay(50, config), 64_000);
    assertDelayMs(getReconnectDelay(100, config), 64_000);
  });
});

describe("getReconnectDelayMs", () => {
  it("returns millisecond values for compatibility", () => {
    assert.strictEqual(getReconnectDelayMs(0), 1_000);
    assert.strictEqual(getReconnectDelayMs(1), 2_000);
    assert.strictEqual(getReconnectDelayMs(7), null);
  });
});

describe("DEFAULT_RECONNECT_BACKOFF", () => {
  it("has sensible defaults", () => {
    assert.strictEqual(
      Duration.toMillis(Duration.fromInputUnsafe(DEFAULT_RECONNECT_BACKOFF.initialDelay)),
      1_000,
    );
    assert.strictEqual(DEFAULT_RECONNECT_BACKOFF.backoffFactor, 2);
    assert.strictEqual(
      Duration.toMillis(Duration.fromInputUnsafe(DEFAULT_RECONNECT_BACKOFF.maxDelay)),
      64_000,
    );
    assert.deepStrictEqual(DEFAULT_RECONNECT_BACKOFF.maxRetries, Option.some(7));
  });
});
