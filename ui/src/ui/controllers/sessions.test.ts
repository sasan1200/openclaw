import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionsListResult } from "../types.ts";
import {
  applySessionsChangedEvent,
  buildSessionsListLastHashParamsKey,
  createSessionAndRefresh,
  deleteSessionsAndRefresh,
  loadSessions,
  patchSession,
  subscribeSessions,
  type SessionsState,
} from "./sessions.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

if (!("window" in globalThis)) {
  Object.assign(globalThis, {
    window: {
      confirm: () => false,
    },
  });
}

function createState(request: RequestFn, overrides: Partial<SessionsState> = {}): SessionsState {
  return {
    client: { request } as unknown as SessionsState["client"],
    connected: true,
    sessionsLoading: false,
    sessionsResult: null,
    sessionsListLastHash: null,
    sessionsListLastHashParamsKey: null,
    sessionsError: null,
    sessionsFilterActive: "0",
    sessionsFilterLimit: "0",
    sessionsIncludeGlobal: true,
    sessionsIncludeUnknown: true,
    sessionsExpandedCheckpointKey: null,
    sessionsCheckpointItemsByKey: {},
    sessionsCheckpointLoadingKey: null,
    sessionsCheckpointBusyKey: null,
    sessionsCheckpointErrorByKey: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadSessions cache hash", () => {
  it("sends lastHash when params match sessionsListLastHashParamsKey", async () => {
    const request = vi.fn(async () => ({ unchanged: true, hash: "abc123", ts: 1, count: 0 }));
    const paramsKey = buildSessionsListLastHashParamsKey({
      includeGlobal: true,
      includeUnknown: true,
    });
    const state = createState(request, {
      sessionsListLastHash: "abc123",
      sessionsListLastHashParamsKey: paramsKey,
    });

    await loadSessions(state);

    expect(request).toHaveBeenCalledWith(
      "sessions.list",
      expect.objectContaining({
        includeGlobal: true,
        includeUnknown: true,
        lastHash: "abc123",
      }),
    );
    expect(state.sessionsListLastHash).toBe("abc123");
    expect(state.sessionsListLastHashParamsKey).toBe(paramsKey);
  });

  it("preserves rows and applies count when server returns unchanged", async () => {
    const existing: SessionsListResult = {
      ts: 1,
      path: "p",
      count: 1,
      defaults: { modelProvider: null, model: null, contextTokens: null },
      sessions: [{ key: "k", kind: "direct", updatedAt: 1 }],
    };
    const request = vi.fn(async () => ({ unchanged: true, hash: "next", ts: 2, count: 7 }));
    const paramsKey = buildSessionsListLastHashParamsKey({
      includeGlobal: true,
      includeUnknown: true,
    });
    const state = createState(request, {
      sessionsResult: existing,
      sessionsListLastHash: "old",
      sessionsListLastHashParamsKey: paramsKey,
    });

    await loadSessions(state);

    expect(state.sessionsResult).not.toBe(existing);
    expect(state.sessionsResult).toEqual({ ...existing, count: 7 });
    expect(state.sessionsListLastHash).toBe("next");
  });

  it("includes activeMinutes in the unchanged-key path so stale hashes are not reused", async () => {
    const base = buildSessionsListLastHashParamsKey({
      includeGlobal: true,
      includeUnknown: true,
      activeMinutes: 15,
    });
    const next = buildSessionsListLastHashParamsKey({
      includeGlobal: true,
      includeUnknown: true,
      activeMinutes: 30,
    });
    expect(base).not.toBe(next);
  });

  it("replaces sessionsResult and hash on full list payload", async () => {
    const full: SessionsListResult & { hash?: string } = {
      ts: 1,
      path: "p",
      count: 1,
      defaults: { modelProvider: null, model: null, contextTokens: null },
      sessions: [{ key: "k", kind: "direct", updatedAt: 1 }],
      hash: "fullhash",
    };
    const request = vi.fn(async () => full);
    const state = createState(request);

    await loadSessions(state);

    expect(state.sessionsResult).toEqual(full);
    expect(state.sessionsListLastHash).toBe("fullhash");
    expect(state.sessionsListLastHashParamsKey).toBe(
      buildSessionsListLastHashParamsKey({ includeGlobal: true, includeUnknown: true }),
    );
  });

  it("clears lastHash tracking on error", async () => {
    const request = vi.fn(async () => {
      throw new Error("network");
    });
    const state = createState(request, {
      sessionsListLastHash: "x",
      sessionsListLastHashParamsKey: "y",
    });

    await loadSessions(state);

    expect(state.sessionsListLastHash).toBeNull();
    expect(state.sessionsListLastHashParamsKey).toBeNull();
    expect(state.sessionsError).toBe("Error: network");
  });
});

describe("subscribeSessions", () => {
  it("registers for session change events", async () => {
    const request = vi.fn(async () => ({ subscribed: true }));
    const state = createState(request);

    await subscribeSessions(state);

    expect(request).toHaveBeenCalledWith("sessions.subscribe", {});
    expect(state.sessionsError).toBeNull();
  });
});

describe("createSessionAndRefresh", () => {
  it("creates a dashboard session and refreshes the session list", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") {
        return { key: "agent:main:dashboard:abc" };
      }
      if (method === "sessions.list") {
        return {
          ts: 2,
          path: "(multiple)",
          count: 1,
          defaults: {},
          sessions: [{ key: "agent:main:dashboard:abc", kind: "direct", updatedAt: 2 }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);

    const key = await createSessionAndRefresh(
      state,
      { agentId: "main", parentSessionKey: "agent:main:main" },
      { activeMinutes: 0, limit: 0, includeGlobal: true, includeUnknown: true },
    );

    expect(key).toBe("agent:main:dashboard:abc");
    expect(request).toHaveBeenNthCalledWith(1, "sessions.create", {
      agentId: "main",
      parentSessionKey: "agent:main:main",
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(state.sessionsResult?.sessions[0]?.key).toBe("agent:main:dashboard:abc");
    expect(state.sessionsLoading).toBe(false);
  });

  it("keeps the current state when create does not return a key", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") {
        return {};
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);

    const key = await createSessionAndRefresh(state);

    expect(key).toBeNull();
    expect(state.sessionsError).toBe("Error: sessions.create returned no key");
    expect(state.sessionsLoading).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not start a create mutation while sessions are loading", async () => {
    const request = vi.fn(async () => ({ key: "agent:main:dashboard:abc" }));
    const state = createState(request, { sessionsLoading: true });

    const key = await createSessionAndRefresh(state);

    expect(key).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("deleteSessionsAndRefresh", () => {
  it("deletes multiple sessions and refreshes", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.delete") {
        return { ok: true };
      }
      if (method === "sessions.list") {
        return undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSessionsAndRefresh(state, ["key-a", "key-b"]);

    expect(deleted).toEqual(["key-a", "key-b"]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(1, "sessions.delete", {
      key: "key-a",
      deleteTranscript: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.delete", {
      key: "key-b",
      deleteTranscript: true,
    });
    expect(request).toHaveBeenNthCalledWith(3, "sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(state.sessionsLoading).toBe(false);
  });

  it("returns empty array when user cancels", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const deleted = await deleteSessionsAndRefresh(state, ["key-a"]);

    expect(deleted).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("returns partial results when some deletes fail", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "sessions.delete") {
        const p = params as { key: string };
        if (p.key === "key-b" || p.key === "key-c") {
          throw new Error(`delete failed: ${p.key}`);
        }
        return { ok: true };
      }
      if (method === "sessions.list") {
        return undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSessionsAndRefresh(state, ["key-a", "key-b", "key-c", "key-d"]);

    expect(deleted).toEqual(["key-a", "key-d"]);
    expect(state.sessionsError).toBe("Error: delete failed: key-b; Error: delete failed: key-c");
    expect(state.sessionsLoading).toBe(false);
  });

  it("returns empty array when already loading", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request, { sessionsLoading: true });

    const deleted = await deleteSessionsAndRefresh(state, ["key-a"]);

    expect(deleted).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("queues refreshes requested during delete without releasing mutation loading", async () => {
    let resolveDelete: () => void = () => undefined;
    let signalDeleteStarted: () => void = () => undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });
    const deleteBlocker = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.delete") {
        signalDeleteStarted();
        await deleteBlocker;
        return { ok: true };
      }
      if (method === "sessions.list") {
        return {
          ts: 2,
          path: "(multiple)",
          count: 0,
          defaults: {},
          sessions: [],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deletePromise = deleteSessionsAndRefresh(state, ["key-a"]);
    await deleteStarted;
    expect(state.sessionsLoading).toBe(true);

    await loadSessions(state);
    expect(request).toHaveBeenCalledTimes(1);
    expect(state.sessionsLoading).toBe(true);

    resolveDelete();
    const deleted = await deletePromise;

    expect(deleted).toEqual(["key-a"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(2, "sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(state.sessionsLoading).toBe(false);
  });

  it("clears lastHash before post-delete refresh", async () => {
    const request: RequestFn = vi.fn(async (method: string) => {
      if (method === "sessions.delete") {
        return { ok: true };
      }
      if (method === "sessions.list") {
        return {
          ts: 1,
          path: "p",
          count: 0,
          defaults: { modelProvider: null, model: null, contextTokens: null },
          sessions: [],
          hash: "fresh",
        };
      }
      throw new Error(`unexpected: ${method}`);
    });
    const paramsKey = buildSessionsListLastHashParamsKey({
      includeGlobal: true,
      includeUnknown: true,
    });
    const state = createState(request, {
      sessionsListLastHash: "stale",
      sessionsListLastHashParamsKey: paramsKey,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await deleteSessionsAndRefresh(state, ["key-a"]);

    const listCall = vi.mocked(request).mock.calls.find(([method]) => method === "sessions.list");
    expect(listCall).toBeDefined();
    expect((listCall![1] as Record<string, unknown>)?.lastHash).toBeUndefined();
  });
});

describe("loadSessions", () => {
  it("coalesces overlapping refreshes instead of dropping the latest request", async () => {
    let resolveFirst: () => void = () => undefined;
    const firstBlocker = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const request = vi.fn(async (method: string) => {
      if (method !== "sessions.list") {
        throw new Error(`unexpected method: ${method}`);
      }
      if (request.mock.calls.length === 1) {
        await firstBlocker;
        return {
          ts: 1,
          path: "(multiple)",
          count: 0,
          defaults: {},
          sessions: [],
        };
      }
      return {
        ts: 2,
        path: "(multiple)",
        count: 0,
        defaults: {},
        sessions: [],
      };
    });
    const state = createState(request, {
      sessionsFilterActive: "30",
      sessionsFilterLimit: "10",
    });

    const first = loadSessions(state);
    const second = loadSessions(state, { activeMinutes: 0, limit: 0 });
    expect(request).toHaveBeenCalledTimes(1);

    resolveFirst();
    await Promise.all([first, second]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {
      activeMinutes: 30,
      limit: 10,
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(state.sessionsResult?.ts).toBe(2);
    expect(state.sessionsLoading).toBe(false);
  });

  it("refreshes expanded checkpoint cards when the row summary changes", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.list") {
        return {
          ts: 1,
          path: "(multiple)",
          count: 1,
          defaults: {},
          sessions: [
            {
              key: "agent:main:main",
              kind: "direct",
              updatedAt: 1,
              compactionCheckpointCount: 1,
              latestCompactionCheckpoint: {
                checkpointId: "checkpoint-new",
                createdAt: 20,
              },
            },
          ],
        };
      }
      if (method === "sessions.compaction.list") {
        return {
          ok: true,
          key: "agent:main:main",
          checkpoints: [
            {
              checkpointId: "checkpoint-new",
              sessionKey: "agent:main:main",
              sessionId: "session-1",
              createdAt: 20,
              reason: "manual",
            },
          ],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request, {
      sessionsExpandedCheckpointKey: "agent:main:main",
      sessionsResult: {
        ts: 0,
        path: "(multiple)",
        count: 1,
        defaults: {},
        sessions: [
          {
            key: "agent:main:main",
            kind: "direct",
            updatedAt: 0,
            compactionCheckpointCount: 3,
            latestCompactionCheckpoint: {
              checkpointId: "checkpoint-old",
              createdAt: 10,
            },
          },
        ],
      } as never,
      sessionsCheckpointItemsByKey: {
        "agent:main:main": [
          {
            checkpointId: "checkpoint-old",
            sessionKey: "agent:main:main",
            sessionId: "session-old",
            createdAt: 10,
            reason: "manual",
          },
        ] as never,
      },
    });

    await loadSessions(state);

    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.compaction.list", {
      key: "agent:main:main",
    });
    expect(
      state.sessionsCheckpointItemsByKey["agent:main:main"]?.map((item) => item.checkpointId),
    ).toEqual(["checkpoint-new"]);
  });
});

describe("patchSession", () => {
  it("clears lastHash before post-patch refresh", async () => {
    const request: RequestFn = vi.fn(async (method: string) => {
      if (method === "sessions.patch") {
        return { ok: true };
      }
      if (method === "sessions.list") {
        return {
          ts: 1,
          path: "p",
          count: 0,
          defaults: { modelProvider: null, model: null, contextTokens: null },
          sessions: [],
          hash: "fresh",
        };
      }
      throw new Error(`unexpected: ${method}`);
    });
    const paramsKey = buildSessionsListLastHashParamsKey({
      includeGlobal: true,
      includeUnknown: true,
    });
    const state = createState(request, {
      sessionsListLastHash: "stale",
      sessionsListLastHashParamsKey: paramsKey,
    });

    await patchSession(state, "key-a", { label: "renamed" });

    const listCall = vi.mocked(request).mock.calls.find(([method]) => method === "sessions.list");
    expect(listCall).toBeDefined();
    expect((listCall![1] as Record<string, unknown>)?.lastHash).toBeUndefined();
  });
});

describe("applySessionsChangedEvent", () => {
  it("updates fresh context usage from websocket event payloads", () => {
    const state = createState(async () => undefined, {
      sessionsResult: {
        ts: 1,
        path: "(multiple)",
        count: 1,
        defaults: { modelProvider: "openai", model: "gpt-5.4", contextTokens: 200_000 },
        sessions: [
          {
            key: "agent:main:main",
            kind: "direct",
            updatedAt: 1,
            totalTokens: 20_000,
            totalTokensFresh: true,
            contextTokens: 200_000,
          },
        ],
      },
    });

    const applied = applySessionsChangedEvent(state, {
      sessionKey: "agent:main:main",
      ts: 2,
      totalTokens: 190_000,
      totalTokensFresh: true,
      contextTokens: 200_000,
      model: "gpt-5.4",
    });

    expect(applied).toEqual({ applied: true, change: "updated" });
    expect(state.sessionsResult?.ts).toBe(2);
    expect(state.sessionsResult?.sessions[0]).toMatchObject({
      key: "agent:main:main",
      totalTokens: 190_000,
      totalTokensFresh: true,
      contextTokens: 200_000,
      model: "gpt-5.4",
    });
  });

  it("clears old token totals when the gateway marks the measurement stale", () => {
    const state = createState(async () => undefined, {
      sessionsResult: {
        ts: 1,
        path: "(multiple)",
        count: 1,
        defaults: { modelProvider: null, model: null, contextTokens: 200_000 },
        sessions: [
          {
            key: "agent:main:main",
            kind: "direct",
            updatedAt: 1,
            totalTokens: 190_000,
            totalTokensFresh: true,
            contextTokens: 200_000,
          },
        ],
      },
    });

    applySessionsChangedEvent(state, {
      sessionKey: "agent:main:main",
      totalTokensFresh: false,
      contextTokens: 200_000,
    });

    expect(state.sessionsResult?.sessions[0]?.totalTokens).toBeUndefined();
    expect(state.sessionsResult?.sessions[0]?.totalTokensFresh).toBe(false);
    expect(state.sessionsResult?.sessions[0]?.contextTokens).toBe(200_000);
  });

  it("keeps updated existing rows sorted like sessions.list", () => {
    const state = createState(async () => undefined, {
      sessionsResult: {
        ts: 1,
        path: "(multiple)",
        count: 2,
        defaults: { modelProvider: null, model: null, contextTokens: null },
        sessions: [
          {
            key: "agent:main:newer",
            kind: "direct",
            updatedAt: 10,
          },
          {
            key: "agent:main:older",
            kind: "direct",
            updatedAt: 1,
          },
        ],
      },
    });

    const applied = applySessionsChangedEvent(state, {
      sessionKey: "agent:main:older",
      ts: 2,
      updatedAt: 20,
    });

    expect(applied).toEqual({ applied: true, change: "updated" });
    expect(state.sessionsResult?.sessions.map((row) => row.key)).toEqual([
      "agent:main:older",
      "agent:main:newer",
    ]);
  });

  it("reports when websocket event payloads insert new rows", () => {
    const state = createState(async () => undefined, {
      sessionsResult: {
        ts: 1,
        path: "(multiple)",
        count: 0,
        defaults: { modelProvider: null, model: null, contextTokens: null },
        sessions: [],
      },
    });

    const applied = applySessionsChangedEvent(state, {
      sessionKey: "agent:main:new",
      ts: 2,
      kind: "direct",
      updatedAt: 2,
    });

    expect(applied).toEqual({ applied: true, change: "inserted" });
    expect(state.sessionsResult?.count).toBe(1);
    expect(state.sessionsResult?.sessions[0]).toMatchObject({
      key: "agent:main:new",
      kind: "direct",
      updatedAt: 2,
    });
  });
});
