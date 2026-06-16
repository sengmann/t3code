import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const reactMock = vi.hoisted(() => ({
  useDeferredValue: vi.fn<(text: string) => string>(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useDeferredValue: reactMock.useDeferredValue,
}));

import ChatMarkdown from "./ChatMarkdown";

describe("ChatMarkdown streaming rendering", () => {
  beforeEach(() => {
    reactMock.useDeferredValue.mockReset();
  });

  it("renders the scheduled markdown text instead of the latest streaming source", () => {
    reactMock.useDeferredValue.mockReturnValue("**deferred markdown**");

    const markup = renderToStaticMarkup(
      <ChatMarkdown text="latest markdown" cwd={undefined} isStreaming />,
    );

    expect(reactMock.useDeferredValue).toHaveBeenCalledWith("latest markdown");
    expect(markup).toContain("<strong>deferred markdown</strong>");
    expect(markup).not.toContain("latest markdown");
  });

  it("renders the latest markdown immediately after streaming finishes", () => {
    reactMock.useDeferredValue.mockReturnValue("stale markdown");

    const markup = renderToStaticMarkup(<ChatMarkdown text="final markdown" cwd={undefined} />);

    expect(markup).toContain("final markdown");
    expect(markup).not.toContain("stale markdown");
  });
});
