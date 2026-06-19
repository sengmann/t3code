import type { ClientSettings } from "@t3tools/contracts/settings";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { getHydratedClientSettings } from "../hooks/useSettings";

export async function loadClientSettingsForNewThread(): Promise<ClientSettings | null> {
  try {
    return await getHydratedClientSettings();
  } catch (error) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not create thread",
        description:
          error instanceof Error
            ? `Could not load your saved default access mode. ${error.message}`
            : "Could not load your saved default access mode. No thread was created.",
      }),
    );
    return null;
  }
}
