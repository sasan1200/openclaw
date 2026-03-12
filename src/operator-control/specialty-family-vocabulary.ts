import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { resolveOperatorReferenceSourcePath } from "./reference-paths.js";

type RawSpecialtyFamilyVocabulary = {
  families?: Array<{
    id?: unknown;
    aliases?: unknown;
  }>;
};

type VocabularySourceParams = {
  sourcePath?: string;
};

const EMPTY_VOCABULARY = {
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

function resolveSpecialtyFamilyVocabularySourcePath(params?: VocabularySourceParams): string {
  return resolveOperatorReferenceSourcePath("operator-specialty-family-vocabulary.yaml", params);
}

let cachedVocabulary: {
  sourcePath: string;
  mtimeMs: number;
  canonical: Set<string>;
  aliasToCanonical: Map<string, string>;
} | null = null;

function loadSpecialtyFamilyVocabulary(params?: VocabularySourceParams): Map<string, string> {
  const sourcePath = resolveSpecialtyFamilyVocabularySourcePath(params);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(sourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY_VOCABULARY.aliasToCanonical;
    }
    throw error;
  }
  if (
    cachedVocabulary &&
    cachedVocabulary.sourcePath === sourcePath &&
    cachedVocabulary.mtimeMs === stats.mtimeMs
  ) {
    return cachedVocabulary.aliasToCanonical;
  }

  const raw = fs.readFileSync(sourcePath, "utf8");
  const parsed = (YAML.parse(raw, { schema: "core" }) ?? {}) as RawSpecialtyFamilyVocabulary;
  const canonical = new Set<string>();
  const aliasToCanonical = new Map<string, string>();

  for (const entry of parsed.families ?? []) {
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
    canonical,
    aliasToCanonical,
  };
  return aliasToCanonical;
}

function extractSpecialtyLead(specialty: string): string {
  const trimmed = specialty.trim().replaceAll("\\u2014", "—");
  if (!trimmed) {
    return "";
  }
  const longDash = trimmed.split("—", 2)[0]?.trim();
  if (longDash && longDash.length < trimmed.length) {
    return longDash;
  }
  const spacedDash = trimmed.split(" - ", 2)[0]?.trim();
  if (spacedDash && spacedDash.length < trimmed.length) {
    return spacedDash;
  }
  return trimmed;
}

export function deriveOperatorSpecialtyFamily(
  specialty: string | null,
  params?: VocabularySourceParams,
): string | null {
  if (!specialty?.trim()) {
    return null;
  }
  const lead = normalize(extractSpecialtyLead(specialty));
  return loadSpecialtyFamilyVocabulary(params).get(lead) ?? null;
}

export function getOperatorSpecialtyFamilyVocabularyStats(params?: VocabularySourceParams): {
  canonicalCount: number;
  aliasCount: number;
} {
  const vocabulary =
    cachedVocabulary ??
    (() => {
      loadSpecialtyFamilyVocabulary(params);
      return cachedVocabulary;
    })();
  return {
    canonicalCount: vocabulary?.canonical.size ?? 0,
    aliasCount: (vocabulary?.aliasToCanonical.size ?? 0) - (vocabulary?.canonical.size ?? 0),
  };
}

export function getOperatorSpecialtyFamilyVocabularySourcePath(): string {
  return path.resolve(resolveSpecialtyFamilyVocabularySourcePath());
}
