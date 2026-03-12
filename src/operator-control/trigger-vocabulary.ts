import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { resolveOperatorReferenceSourcePath } from "./reference-paths.js";

type RawTriggerVocabulary = {
  triggers?: Array<{
    id?: unknown;
    aliases?: unknown;
  }>;
};

type CompiledTriggerVocabulary = {
  canonical: Set<string>;
  aliasToCanonical: Map<string, string>;
};

type VocabularySourceParams = {
  sourcePath?: string;
};

const EMPTY_VOCABULARY: CompiledTriggerVocabulary = {
  canonical: new Set<string>(),
  aliasToCanonical: new Map<string, string>(),
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function resolveTriggerVocabularySourcePath(params?: VocabularySourceParams): string {
  return resolveOperatorReferenceSourcePath("operator-trigger-vocabulary.yaml", params);
}

let cachedVocabulary: {
  sourcePath: string;
  mtimeMs: number;
  compiled: CompiledTriggerVocabulary;
} | null = null;

function loadOperatorTriggerVocabulary(params?: VocabularySourceParams): CompiledTriggerVocabulary {
  const sourcePath = resolveTriggerVocabularySourcePath(params);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(sourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY_VOCABULARY;
    }
    throw error;
  }
  if (
    cachedVocabulary &&
    cachedVocabulary.sourcePath === sourcePath &&
    cachedVocabulary.mtimeMs === stats.mtimeMs
  ) {
    return cachedVocabulary.compiled;
  }

  const raw = fs.readFileSync(sourcePath, "utf8");
  const parsed = (YAML.parse(raw, { schema: "core" }) ?? {}) as RawTriggerVocabulary;
  const canonical = new Set<string>();
  const aliasToCanonical = new Map<string, string>();

  for (const entry of parsed.triggers ?? []) {
    const id = typeof entry.id === "string" ? normalize(entry.id) : "";
    if (!id) {
      continue;
    }
    canonical.add(id);
    aliasToCanonical.set(id, id);
    for (const alias of asStringArray(entry.aliases)) {
      aliasToCanonical.set(normalize(alias), id);
    }
  }

  const compiled = { canonical, aliasToCanonical };
  cachedVocabulary = {
    sourcePath,
    mtimeMs: stats.mtimeMs,
    compiled,
  };
  return compiled;
}

export function normalizeOperatorTrigger(trigger: string, params?: VocabularySourceParams): string {
  const needle = normalize(trigger);
  return loadOperatorTriggerVocabulary(params).aliasToCanonical.get(needle) ?? needle;
}

export function getOperatorTriggerVocabularyStats(params?: VocabularySourceParams): {
  canonicalCount: number;
  aliasCount: number;
} {
  const vocabulary = loadOperatorTriggerVocabulary(params);
  return {
    canonicalCount: vocabulary.canonical.size,
    aliasCount: vocabulary.aliasToCanonical.size - vocabulary.canonical.size,
  };
}

export function getOperatorTriggerVocabularySourcePath(): string {
  return path.resolve(resolveTriggerVocabularySourcePath());
}
