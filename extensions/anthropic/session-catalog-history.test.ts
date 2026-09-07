import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { describe, expect, it, vi } from "vitest";
import { importClaudeHistory } from "./session-catalog-history.js";
import { parseTranscriptLine } from "./session-catalog-transcript.js";

const appended: Array<Record<string, unknown>> = [];

vi.mock("openclaw/plugin-sdk/session-transcript-runtime", () => ({
  withSessionTranscriptWriteLock: async (
    _params: unknown,
    run: (transcript: {
      appendMessage: (input: { message: Record<string, unknown> }) => Promise<void>;
    }) => Promise<void>,
  ) => {
    await run({
      appendMessage: async ({ message }) => {
        appended.push(message);
      },
    });
  },
}));

describe("importClaudeHistory", () => {
  it("omits metadata without changing other native conversation rows", async () => {
    appended.length = 0;
    const parse = (entry: Record<string, unknown>) =>
      parseTranscriptLine(Buffer.from(JSON.stringify(entry)), (value, maxLength) =>
        typeof value === "string" && value.length <= maxLength ? value : undefined,
      );
    const items = [
      parse({
        type: "user",
        isMeta: true,
        message: { role: "user", content: "private skill instructions" },
      }),
      parse({
        type: "user",
        uuid: "operator-1",
        message: { role: "user", content: "run the review" },
      }),
      parse({
        type: "user",
        isCompactSummary: true,
        message: { role: "user", content: "compacted context" },
      }),
      parse({
        type: "user",
        isVisibleInTranscriptOnly: true,
        message: { role: "user", content: "transcript-only context" },
      }),
      parse({
        type: "assistant",
        message: { role: "assistant", content: "done" },
      }),
    ].filter((item) => item !== undefined);

    await importClaudeHistory({
      items,
      threadId: "thread-1",
      storePath: "/tmp/sessions.json",
      sessionId: "session-1",
      sessionKey: "agent:main:catalog-adopt",
      agentId: "main",
      config: {} as OpenClawConfig,
    });

    expect(JSON.stringify(appended)).not.toContain("private skill instructions");
    expect(appended.find((message) => message.content === "run the review")?.provenance).toBe(
      undefined,
    );
    expect(appended.map((message) => message.content)).toEqual(
      expect.arrayContaining(["run the review", "compacted context", "transcript-only context"]),
    );
    expect(appended.find((message) => message.role === "assistant")).toBeDefined();
  });

  it("preserves Date.parse semantics for valid strings and falls back for invalid values", async () => {
    appended.length = 0;
    const fallbackTimestamp = new Date("2026-07-18T12:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(fallbackTimestamp);
    try {
      await importClaudeHistory({
        items: [
          { type: "userMessage", text: "invalid", timestamp: "not-a-date", uuid: "u-1" },
          { type: "userMessage", text: "numeric year", timestamp: "2026", uuid: "u-2" },
          { type: "userMessage", text: "numeric zero", timestamp: "0", uuid: "u-3" },
          {
            type: "userMessage",
            text: "pre-epoch",
            timestamp: "1969-12-31T23:59:59.000Z",
            uuid: "u-4",
          },
        ],
        threadId: "thread-1",
        storePath: "/tmp/sessions.json",
        sessionId: "session-1",
        sessionKey: "agent:main:catalog-adopt",
        agentId: "main",
        config: {} as OpenClawConfig,
      });
    } finally {
      vi.useRealTimers();
    }

    expect(appended).toHaveLength(4);
    expect(appended.map((message) => message.timestamp)).toEqual([
      -1_000,
      Date.parse("0"),
      Date.parse("2026"),
      fallbackTimestamp + 3,
    ]);
    expect(JSON.stringify(appended)).not.toContain('"timestamp":null');
  });

  it("tags imported native user rows so self-echo provenance excludes them", async () => {
    appended.length = 0;
    await importClaudeHistory({
      items: [
        { type: "userMessage", text: "continue", uuid: "u-1" },
        { type: "assistantMessage", text: "done", uuid: "a-1" },
      ],
      threadId: "thread-1",
      storePath: "/tmp/sessions.json",
      sessionId: "session-1",
      sessionKey: "agent:main:catalog-adopt",
      agentId: "main",
      config: {} as OpenClawConfig,
    });

    const userRow = appended.find((message) => message.role === "user");
    // mirrorOrigin keeps imported native prompts out of ownRecentUserTexts; without
    // it a repeated external prompt like "continue" is swallowed as self-echo.
    //
    // The other three are the thread back to the line this came from. Without them an
    // adopted conversation is a copy with nothing tying it to its original, and anything
    // that has to act on the upstream file — going back to a point in it, above all —
    // has no way to find where. Measured on a real machine before this was added: none
    // of 275 imported entries could be located in the 85MB transcript they came from, by
    // id, by timestamp, or by anything else.
    expect(userRow?.["__openclaw"]).toMatchObject({
      mirrorOrigin: "claude-catalog-import",
      importedFrom: "claude",
      cliSessionId: "thread-1",
      externalId: "u-1",
    });
    const assistantRow = appended.find((message) => message.role === "assistant");
    expect(assistantRow).toBeDefined();
    expect(assistantRow?.["__openclaw"]).toBeUndefined();
  });

  it("claims no identity for a row the transcript gave none", async () => {
    // A line with no uuid cannot be pointed back at, and saying otherwise would be worse
    // than saying nothing: the whole reason for recording this is that something may one
    // day cut the upstream file at the place it names.
    appended.length = 0;
    await importClaudeHistory({
      items: [{ type: "userMessage", text: "continue" }],
      threadId: "thread-1",
      storePath: "/tmp/sessions.json",
      sessionId: "session-1",
      sessionKey: "agent:main:catalog-adopt",
      agentId: "main",
      config: {} as OpenClawConfig,
    });
    const row = appended.find((message) => message.role === "user");
    const said = row?.["__openclaw"] as Record<string, unknown> | undefined;
    expect(said).toMatchObject({ cliSessionId: "thread-1" });
    expect(said && "externalId" in said).toBe(false);
  });

  it("omits empty native reasoning records instead of rendering a placeholder", async () => {
    appended.length = 0;
    await importClaudeHistory({
      items: [
        { type: "reasoning", content: [{ type: "thinking", thinking: "" }], uuid: "r-1" },
        { type: "assistantMessage", text: "AUTH_OK", uuid: "a-1" },
      ],
      threadId: "thread-1",
      storePath: "/tmp/sessions.json",
      sessionId: "session-1",
      sessionKey: "agent:main:catalog-adopt",
      agentId: "main",
      config: {} as OpenClawConfig,
    });

    expect(appended).toHaveLength(1);
    expect(JSON.stringify(appended)).toContain("AUTH_OK");
    expect(JSON.stringify(appended)).not.toContain("Unsupported Claude transcript item");
  });

  it("retains the placeholder for unsupported non-reasoning records", async () => {
    appended.length = 0;
    await importClaudeHistory({
      items: [{ type: "toolCall", content: [{ type: "tool_use" }], uuid: "t-1" }],
      threadId: "thread-1",
      storePath: "/tmp/sessions.json",
      sessionId: "session-1",
      sessionKey: "agent:main:catalog-adopt",
      agentId: "main",
      config: {} as OpenClawConfig,
    });

    expect(appended).toHaveLength(1);
    expect(JSON.stringify(appended)).toContain("Unsupported Claude transcript item");
  });
});
