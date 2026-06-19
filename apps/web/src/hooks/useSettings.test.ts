import { DEFAULT_CLIENT_SETTINGS, type DesktopBridge } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function stubDesktopSettings(getClientSettings: DesktopBridge["getClientSettings"]): void {
  vi.stubGlobal("window", {
    desktopBridge: {
      getClientSettings,
    } as DesktopBridge,
  });
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getHydratedClientSettings", () => {
  it("waits for persisted settings instead of returning the eager defaults", async () => {
    const persistedSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      defaultRuntimeMode: "approval-required" as const,
    };
    const settingsRequest = deferred<typeof persistedSettings | null>();
    stubDesktopSettings(() => settingsRequest.promise);
    const { getHydratedClientSettings } = await import("./useSettings");
    let settled = false;

    const hydration = getHydratedClientSettings().then((settings) => {
      settled = true;
      return settings;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    settingsRequest.resolve(persistedSettings);
    await expect(hydration).resolves.toEqual(persistedSettings);
  });

  it("rejects when persisted settings cannot be loaded", async () => {
    const error = new Error("settings unavailable");
    stubDesktopSettings(() => Promise.reject(error));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getHydratedClientSettings } = await import("./useSettings");

    await expect(getHydratedClientSettings()).rejects.toBe(error);
  });

  it("blocks new-thread defaults when persisted settings cannot be loaded", async () => {
    const error = new Error("settings unavailable");
    stubDesktopSettings(() => Promise.reject(error));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { toastManager } = await import("../components/ui/toast");
    const addToast = vi.spyOn(toastManager, "add").mockImplementation(() => "toast-1");
    const { loadClientSettingsForNewThread } = await import("../lib/clientSettingsHydration");

    await expect(loadClientSettingsForNewThread()).resolves.toBeNull();
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Could not create thread",
      }),
    );
  });
});
