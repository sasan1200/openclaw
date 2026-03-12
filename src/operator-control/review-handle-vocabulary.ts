import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { resolveOperatorReferenceSourcePath } from "./reference-paths.js";

type RawReviewHandleVocabulary = {
  review_handles?: Array<{
    id?: unknown;
    aliases?: unknown;
  }>;
};

type VocabularySourceParams = {
  sourcePath?: string;
};

const EMPTY_VOCABULARY = {
  aliasToCanonical: new Map<string, string>(),
  canonical: new Set<string>(),
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

function resolveReviewHandleVocabularySourcePath(params?: VocabularySourceParams): string {
  return resolveOperatorReferenceSourcePath("operator-review-handle-vocabulary.yaml", params);
}

let cachedVocabulary: {
  sourcePath: string;
  mtimeMs: number;
  aliasToCanonical: Map<string, string>;
  canonical: Set<string>;
} | null = null;

function loadReviewHandleVocabularyFromSource(params?: VocabularySourceParams): {
  aliasToCanonical: Map<string, string>;
  canonical: Set<string>;
} {
  const sourcePath = resolveReviewHandleVocabularySourcePath(params);
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
    return cachedVocabulary;
  }

  const raw = fs.readFileSync(sourcePath, "utf8");
  const parsed = (YAML.parse(raw, { schema: "core" }) ?? {}) as RawReviewHandleVocabulary;
  const aliasToCanonical = new Map<string, string>();
  const canonical = new Set<string>();

  for (const entry of parsed.review_handles ?? []) {
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

  cachedVocabulary = {
    sourcePath,
    mtimeMs: stats.mtimeMs,
    aliasToCanonical,
    canonical,
  };
  return cachedVocabulary;
}

export function normalizeOperatorReviewHandle(
  handle: string,
  params?: VocabularySourceParams,
): string {
  const needle = normalize(handle);
  return loadReviewHandleVocabularyFromSource(params).aliasToCanonical.get(needle) ?? needle;
}

export function isCanonicalOperatorReviewHandle(
  handle: string,
  params?: VocabularySourceParams,
): boolean {
  return loadReviewHandleVocabularyFromSource(params).canonical.has(normalize(handle));
}

export function getOperatorReviewHandleVocabularyStats(params?: VocabularySourceParams): {
  canonicalCount: number;
  aliasCount: number;
} {
  const vocabulary = loadReviewHandleVocabularyFromSource(params);
  return {
    canonicalCount: vocabulary.canonical.size,
    aliasCount: vocabulary.aliasToCanonical.size - vocabulary.canonical.size,
  };
}

export function getOperatorReviewHandleVocabularySourcePath(): string {
  return path.resolve(resolveReviewHandleVocabularySourcePath());
}
