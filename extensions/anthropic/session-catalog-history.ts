import type { AgentMessage } from "openclaw/plugin-sdk/agent-harness-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { parseDateStringTimestampMs } from "openclaw/plugin-sdk/number-runtime";
import { withSessionTranscriptWriteLock } from "openclaw/plugin-sdk/session-transcript-runtime";
import { CLAUDE_CLI_BACKEND_ID } from "./cli-constants.js";
import type { ClaudeTranscriptItem } from "./session-catalog-transcript.js";

/**
 * What ties an imported row back to the line it came from.
 *
 * `externalId` is the Claude transcript entry's own uuid, which the parser already reads
 * and this used to drop on the floor. Without it an adopted conversation is a copy with
 * no thread back to its original: nothing can say which line of the upstream file a
 * given message came from, so nothing that has to *act* on that file — rewinding it in
 * place, above all — can find where to act. Measured before writing this: zero of 275
 * imported entries could be located in an 85MB transcript, by id, by timestamp, or by
 * anything else.
 *
 * All three together, because that is what `readSessionMessageIdentity` wants before it
 * will call a message imported and give it a stable identity across re-projection.
 */
function importedFrom(item: ClaudeTranscriptItem, threadId: string) {
  return {
    // Imported native rows are not OpenClaw-authored; mirrorOrigin excludes them
    // from self-echo provenance so a repeated native prompt stays observable.
    mirrorOrigin: "claude-catalog-import",
    importedFrom: CLAUDE_CATALOG_ID,
    cliSessionId: threadId,
    ...(item.uuid ? { externalId: item.uuid } : {}),
  };
}

/** The catalog these conversations are adopted from, as its rows are labelled. */
const CLAUDE_CATALOG_ID = "claude";

/*
 * On the prompts only, deliberately.
 *
 * A prompt is what anything acting on the upstream file has to find — going back to a
 * point in a conversation means going back to something somebody said. Assistant rows
 * are pinned by a test to carry no metadata at all, and widening that to make the
 * identity tidier would be changing a contract for symmetry rather than for a use.
 */

function importedClaudeMessage(
  item: ClaudeTranscriptItem,
  fallbackTimestamp: number,
  threadId: string,
): AgentMessage | undefined {
  const timestamp = parseDateStringTimestampMs(item.timestamp) ?? fallbackTimestamp;
  const importedText = item.text?.trim();
  if (!importedText && item.type === "reasoning") {
    return undefined;
  }
  const text = importedText || "[Unsupported Claude transcript item]";
  if (item.type === "userMessage") {
    return {
      role: "user",
      content: text,
      timestamp,
      __openclaw: importedFrom(item, threadId),
    } as AgentMessage;
  }
  const prefix =
    item.type === "reasoning"
      ? "Thinking\n\n"
      : item.type === "toolCall"
        ? "Tool call\n\n"
        : item.type === "toolResult"
          ? "Tool result\n\n"
          : "";
  return {
    role: "assistant",
    content: [{ type: "text", text: `${prefix}${text}` }],
    timestamp,
    api: "anthropic-messages",
    provider: CLAUDE_CLI_BACKEND_ID,
    model: "native-history",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
  } as AgentMessage;
}

export async function importClaudeHistory(params: {
  items: ClaudeTranscriptItem[];
  threadId: string;
  sessionId: string;
  sessionKey: string;
  agentId: string;
  storePath: string;
  cwd?: string;
  config: OpenClawConfig;
}): Promise<void> {
  const items = params.items.toReversed();
  await withSessionTranscriptWriteLock(params, async (transcript) => {
    for (const [index, item] of items.entries()) {
      const imported = importedClaudeMessage(item, Date.now() + index, params.threadId);
      if (!imported) {
        continue;
      }
      // The idempotency key rides on the message so recovery re-imports dedupe.
      const message: AgentMessage & { idempotencyKey: string } = {
        ...imported,
        idempotencyKey: `claude-catalog:${params.threadId}:${item.uuid ?? index}`,
      };
      await transcript.appendMessage({
        message,
        idempotencyLookup: "scan",
        cwd: params.cwd,
      });
    }
  });
}
