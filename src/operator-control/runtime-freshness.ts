import fs from "node:fs";
import { createRequire } from "node:module";
import { resolveCommitHash } from "../infra/git-commit.js";
import { resolveGitHeadPath } from "../infra/git-root.js";
import { resolveOpenClawPackageRootSync } from "../infra/openclaw-root.js";
import { resolveRuntimeServiceVersion } from "../version.js";

export type OperatorRuntimeIdentity = {
  version: string;
  commit: string | null;
  branch: string | null;
  builtAt: string | null;
  runtimeType: "embedded" | "acp" | "unknown";
};

export type OperatorRuntimeFreshnessSnapshot = {
  ready: boolean;
  status: "ready" | "not-ready";
  reasons: string[];
  policy: {
    maxAgeHours: number | null;
    allowedRefs: string[];
  };
  identity: OperatorRuntimeIdentity;
};

type BuildInfo = {
  commit?: string | null;
  builtAt?: string | null;
  branch?: string | null;
};

function readBuildInfo(moduleUrl: string): BuildInfo | null {
  try {
    const require = createRequire(moduleUrl);
    for (const candidate of ["../../build-info.json", "../build-info.json", "./build-info.json"]) {
      try {
        return require(candidate) as BuildInfo;
      } catch {
        // Ignore unreadable candidates.
      }
    }
  } catch {
    // Ignore invalid require context.
  }
  return null;
}

function normalizeBranch(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readGitBranch(params: { cwd?: string; moduleUrl?: string }): string | null {
  const searchDir =
    params.cwd ??
    resolveOpenClawPackageRootSync({ moduleUrl: params.moduleUrl, cwd: process.cwd() }) ??
    process.cwd();
  const headPath = resolveGitHeadPath(searchDir);
  if (!headPath) {
    return null;
  }
  try {
    const head = fs.readFileSync(headPath, "utf-8").trim();
    const match = /^ref:\s+refs\/heads\/(.+)$/u.exec(head);
    return normalizeBranch(match?.[1] ?? null);
  } catch {
    return null;
  }
}

function resolveRuntimeType(env: NodeJS.ProcessEnv): OperatorRuntimeIdentity["runtimeType"] {
  const raw = env.OPENCLAW_RUNTIME_TYPE?.trim().toLowerCase();
  if (raw === "embedded" || raw === "acp") {
    return raw;
  }
  return "unknown";
}

function parseOptionalPositiveNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return raw;
}

function normalizeAllowedRefs(value: string | undefined): string[] {
  return String(value ?? "")
    .split(/[,\s]+/u)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveOperatorRuntimeIdentity(
  options: {
    env?: NodeJS.ProcessEnv;
    moduleUrl?: string;
    cwd?: string;
  } = {},
): OperatorRuntimeIdentity {
  const env = options.env ?? process.env;
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const buildInfo = readBuildInfo(moduleUrl);
  const branch =
    normalizeBranch(env.OPENCLAW_GIT_BRANCH) ??
    normalizeBranch(env.GIT_BRANCH) ??
    normalizeBranch(buildInfo?.branch) ??
    readGitBranch({ cwd: options.cwd, moduleUrl });
  return {
    version: resolveRuntimeServiceVersion(env),
    commit: resolveCommitHash({ env, moduleUrl, cwd: options.cwd }),
    branch,
    builtAt:
      typeof buildInfo?.builtAt === "string" && buildInfo.builtAt.trim()
        ? buildInfo.builtAt.trim()
        : null,
    runtimeType: resolveRuntimeType(env),
  };
}

export function resolveOperatorRuntimeFreshness(
  options: {
    env?: NodeJS.ProcessEnv;
    moduleUrl?: string;
    cwd?: string;
    now?: number;
  } = {},
): OperatorRuntimeFreshnessSnapshot {
  const env = options.env ?? process.env;
  const maxAgeHours = parseOptionalPositiveNumber(env.OPENCLAW_OPERATOR_RUNTIME_MAX_AGE_HOURS);
  const allowedRefs = normalizeAllowedRefs(env.OPENCLAW_OPERATOR_APPROVED_REFS);
  const identity = resolveOperatorRuntimeIdentity({
    env,
    moduleUrl: options.moduleUrl,
    cwd: options.cwd,
  });
  const reasons: string[] = [];
  const identityRequired = allowedRefs.length > 0 || maxAgeHours !== null;

  if (identityRequired && !identity.commit && !identity.branch) {
    reasons.push("runtime commit metadata unavailable");
  }

  if (maxAgeHours !== null && !identity.builtAt) {
    reasons.push("runtime builtAt metadata unavailable");
  } else if (maxAgeHours !== null && identity.builtAt) {
    const builtAtMs = Date.parse(identity.builtAt);
    if (!Number.isFinite(builtAtMs)) {
      reasons.push(`runtime builtAt is invalid (${identity.builtAt})`);
    } else {
      const ageHours = ((options.now ?? Date.now()) - builtAtMs) / (60 * 60 * 1000);
      if (ageHours > maxAgeHours) {
        reasons.push(
          `runtime build is stale (${Math.floor(ageHours)}h old > ${Math.floor(maxAgeHours)}h max)`,
        );
      }
    }
  }

  if (allowedRefs.length > 0) {
    const branch = identity.branch?.toLowerCase() ?? "";
    const commit = identity.commit?.toLowerCase() ?? "";
    const matched = allowedRefs.some(
      (ref) =>
        ref === branch ||
        ref === commit ||
        (commit.length > 0 && ref.length >= commit.length && ref.startsWith(commit)) ||
        (ref.length > 0 && commit.startsWith(ref)),
    );
    if (!matched) {
      reasons.push(
        `runtime ref not approved (branch=${identity.branch ?? "unknown"}, commit=${identity.commit ?? "unknown"})`,
      );
    }
  }

  return {
    ready: reasons.length === 0,
    status: reasons.length === 0 ? "ready" : "not-ready",
    reasons,
    policy: {
      maxAgeHours,
      allowedRefs,
    },
    identity,
  };
}
