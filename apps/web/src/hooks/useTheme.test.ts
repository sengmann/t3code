import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme preferences", () => {
  it("reads and writes Catppuccin theme preferences", async () => {
    const storage = createStorage();
    vi.stubGlobal("window", { localStorage: storage });

    const {
      readSystemDarkThemePreference,
      readSystemLightThemePreference,
      readThemePreference,
      writeSystemDarkThemePreference,
      writeSystemLightThemePreference,
      writeThemePreference,
    } = await import("./useTheme");

    storage.setItem("t3code:theme", "catppuccin-latte");
    expect(readThemePreference()).toBe("catppuccin-latte");

    writeThemePreference("catppuccin-mocha");
    expect(storage.getItem("t3code:theme")).toBe("catppuccin-mocha");
    expect(readThemePreference()).toBe("catppuccin-mocha");

    writeSystemLightThemePreference("catppuccin-latte");
    writeSystemDarkThemePreference("catppuccin-frappe");
    expect(storage.getItem("t3code:theme:system-light")).toBe("catppuccin-latte");
    expect(storage.getItem("t3code:theme:system-dark")).toBe("catppuccin-frappe");
    expect(readSystemLightThemePreference()).toBe("catppuccin-latte");
    expect(readSystemDarkThemePreference()).toBe("catppuccin-frappe");
  });

  it("falls back to system for unknown theme preferences", async () => {
    const storage = createStorage();
    storage.setItem("t3code:theme", "catppuccin-machiato");
    vi.stubGlobal("window", { localStorage: storage });

    const { readThemePreference } = await import("./useTheme");

    expect(readThemePreference()).toBe("system");
  });

  it("resolves Catppuccin themes to app and desktop appearance modes", async () => {
    const { resolveDesktopThemePreference, resolveEffectiveTheme, resolveThemeAppearance } =
      await import("./useTheme");

    expect(resolveThemeAppearance("catppuccin-latte", true)).toBe("light");
    expect(resolveThemeAppearance("catppuccin-frappe", false)).toBe("dark");
    expect(resolveThemeAppearance("catppuccin-macchiato", false)).toBe("dark");
    expect(resolveThemeAppearance("catppuccin-mocha", false)).toBe("dark");
    expect(resolveEffectiveTheme("system", false, "catppuccin-latte", "catppuccin-mocha")).toBe(
      "catppuccin-latte",
    );
    expect(resolveEffectiveTheme("system", true, "catppuccin-latte", "catppuccin-mocha")).toBe(
      "catppuccin-mocha",
    );
    expect(resolveThemeAppearance("system", false, "catppuccin-latte", "catppuccin-mocha")).toBe(
      "light",
    );
    expect(resolveThemeAppearance("system", true, "catppuccin-latte", "catppuccin-frappe")).toBe(
      "dark",
    );
    expect(resolveDesktopThemePreference("catppuccin-latte", true)).toBe("light");
    expect(resolveDesktopThemePreference("catppuccin-frappe", false)).toBe("dark");
    expect(resolveDesktopThemePreference("catppuccin-macchiato", false)).toBe("dark");
    expect(resolveDesktopThemePreference("catppuccin-mocha", false)).toBe("dark");
    expect(resolveDesktopThemePreference("system", true)).toBe("system");
  });
});

describe("theme failure handling", () => {
  it("preserves exact storage causes and operation context", async () => {
    const readCause = new Error("storage read blocked");
    const writeCause = new Error("storage quota exceeded");
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => {
          throw readCause;
        },
        setItem: () => {
          throw writeCause;
        },
      }),
    });

    const { readThemePreference, ThemeStorageError, writeThemePreference } =
      await import("./useTheme");

    try {
      readThemePreference();
      expect.unreachable("expected the theme read to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeStorageError);
      expect(error).toMatchObject({
        operation: "read",
        storageKey: "t3code:theme",
        cause: readCause,
      });
    }

    try {
      writeThemePreference("dark");
      expect.unreachable("expected the theme write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeStorageError);
      expect(error).toMatchObject({
        operation: "write",
        storageKey: "t3code:theme",
        theme: "dark",
        cause: writeCause,
      });
    }
  });

  it("falls back during initial theme application and logs only safe attributes", async () => {
    const cause = new Error("private browsing storage failure");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => {
          throw cause;
        },
      }),
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("document", {
      documentElement: {
        classList: { toggle: vi.fn() },
      },
    });

    await expect(import("./useTheme")).resolves.toBeDefined();

    expect(errorLog).toHaveBeenCalledWith(
      "Failed to read theme preference for t3code:theme.",
      expect.objectContaining({
        operation: "read",
        storageKey: "t3code:theme",
        errorTag: "ThemeStorageError",
      }),
    );
    const attributes = errorLog.mock.calls[0]?.[1];
    expect(attributes).not.toHaveProperty("cause");
    expect(JSON.stringify(attributes)).not.toContain(cause.message);
  });

  it("retries a failed storage read only after a relevant storage event", async () => {
    const cause = new Error("persistent storage failure");
    const getItem = vi.fn(() => {
      throw cause;
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    let readSnapshot: (() => unknown) | undefined;
    let subscribeToTheme: ((listener: () => void) => () => void) | undefined;
    let storageHandler: ((event: StorageEvent) => void) | undefined;
    vi.doMock("react", () => ({
      useCallback: <A>(callback: A) => callback,
      useEffect: () => undefined,
      useSyncExternalStore: (
        subscribe: (listener: () => void) => () => void,
        getSnapshot: () => unknown,
      ) => {
        subscribeToTheme = subscribe;
        readSnapshot = getSnapshot;
        return getSnapshot();
      },
    }));
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === "storage") storageHandler = listener;
      },
      localStorage: createStorage({ getItem }),
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      removeEventListener: () => undefined,
    });

    const { useTheme } = await import("./useTheme");
    useTheme();
    readSnapshot?.();
    readSnapshot?.();

    expect(getItem).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledTimes(1);

    const unsubscribe = subscribeToTheme?.(() => undefined);
    storageHandler?.({ key: "t3code:theme" } as StorageEvent);
    readSnapshot?.();

    expect(getItem).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledTimes(2);
    unsubscribe?.();
  });

  it("preserves desktop sync causes and retries after a failed cosmetic sync", async () => {
    const cause = new Error("desktop IPC unavailable");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const setTheme = vi.fn().mockRejectedValue(cause);
    vi.stubGlobal("window", { desktopBridge: { setTheme } });

    const { DesktopThemeSyncError, syncDesktopTheme, syncDesktopThemePreference } =
      await import("./useTheme");

    const error = await syncDesktopThemePreference({ setTheme }, "dark").then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(DesktopThemeSyncError);
    expect(error).toMatchObject({ theme: "dark", cause });

    setTheme.mockClear();
    syncDesktopTheme("dark");
    await Promise.resolve();
    await Promise.resolve();
    syncDesktopTheme("dark");
    await Promise.resolve();
    await Promise.resolve();

    expect(setTheme).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to sync the dark theme to the desktop shell.",
      expect.objectContaining({
        theme: "dark",
        errorTag: "DesktopThemeSyncError",
      }),
    );
    for (const [, attributes] of errorLog.mock.calls) {
      expect(attributes).not.toHaveProperty("cause");
      expect(JSON.stringify(attributes)).not.toContain(cause.message);
    }
  });
});
