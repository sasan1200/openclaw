import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveOperatorRuntimeFreshness,
  resolveOperatorRuntimeIdentity,
} from "./runtime-freshness.js";

function createTempModuleUrl(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-runtime-freshness-"));
  const entry = path.join(dir, "entry.mjs");
  fs.writeFileSync(entry, "export {};\n", "utf8");
  return pathToFileURL(entry).href;
}

describe("operator runtime freshness", () => {
  it("uses env git metadata when available", () => {
    const identity = resolveOperatorRuntimeIdentity({
      env: {
        OPENCLAW_VERSION: "2026.3.11",
        GIT_COMMIT: "abcdef0123456789",
        OPENCLAW_GIT_BRANCH: "main",
        OPENCLAW_RUNTIME_TYPE: "embedded",
      },
    });

    expect(identity).toMatchObject({
      version: "2026.3.11",
      commit: "abcdef0",
      branch: "main",
      runtimeType: "embedded",
    });
  });

  it("marks stale operator runtimes not-ready", () => {
    const snapshot = resolveOperatorRuntimeFreshness({
      env: {
        OPENCLAW_VERSION: "2026.3.11",
        GIT_COMMIT: "abcdef0123456789",
        OPENCLAW_OPERATOR_RUNTIME_MAX_AGE_HOURS: "24",
      },
      now: Date.parse("2026-03-11T12:00:00.000Z"),
      moduleUrl: new URL("../operator-control/runtime-freshness.test.ts", import.meta.url).href,
    });

    if (snapshot.identity.builtAt !== null) {
      expect(snapshot.ready).toBe(false);
      expect(snapshot.reasons.some((reason) => reason.includes("stale"))).toBe(true);
      return;
    }

    const forced = resolveOperatorRuntimeFreshness({
      env: {
        OPENCLAW_VERSION: "2026.3.11",
        GIT_COMMIT: "abcdef0123456789",
        OPENCLAW_OPERATOR_RUNTIME_MAX_AGE_HOURS: "24",
        OPENCLAW_OPERATOR_APPROVED_REFS: "main",
        OPENCLAW_GIT_BRANCH: "stale-branch",
      },
      now: Date.parse("2026-03-11T12:00:00.000Z"),
    });
    expect(forced.ready).toBe(false);
    expect(forced.reasons.some((reason) => reason.includes("not approved"))).toBe(true);
  });

  it("marks unapproved refs not-ready", () => {
    const snapshot = resolveOperatorRuntimeFreshness({
      env: {
        OPENCLAW_VERSION: "2026.3.11",
        GIT_COMMIT: "abcdef0123456789",
        OPENCLAW_GIT_BRANCH: "feature/tonya",
        OPENCLAW_OPERATOR_APPROVED_REFS: "main,1234567",
      },
    });

    expect(snapshot.ready).toBe(false);
    expect(snapshot.reasons).toContain(
      "runtime ref not approved (branch=feature/tonya, commit=abcdef0)",
    );
  });

  it("stays ready by default when container metadata is unavailable", () => {
    const snapshot = resolveOperatorRuntimeFreshness({
      env: {
        OPENCLAW_VERSION: "2026.3.11",
      },
      cwd: os.tmpdir(),
      moduleUrl: createTempModuleUrl(),
    });

    expect(snapshot.ready).toBe(true);
    expect(snapshot.reasons).toEqual([]);
    expect(snapshot.policy.maxAgeHours).toBeNull();
  });
});
