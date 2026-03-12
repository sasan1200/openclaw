import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getOperatorCapabilityVocabularyStats,
  normalizeOperatorCapability,
} from "./capability-vocabulary.js";
import {
  getOperatorReviewHandleVocabularyStats,
  normalizeOperatorReviewHandle,
} from "./review-handle-vocabulary.js";
import {
  deriveOperatorSpecialtyFamily,
  getOperatorSpecialtyFamilyVocabularyStats,
} from "./specialty-family-vocabulary.js";
import {
  getOperatorTriggerVocabularyStats,
  normalizeOperatorTrigger,
} from "./trigger-vocabulary.js";

const missingSourcePath = path.join("/tmp", "openclaw-missing-vocabulary.yaml");

describe("operator vocabulary fallback", () => {
  it("returns normalized values when capability and trigger vocabularies are absent", () => {
    expect(normalizeOperatorCapability(" UI Review ", { sourcePath: missingSourcePath })).toBe(
      "ui review",
    );
    expect(normalizeOperatorTrigger(" Frontend ", { sourcePath: missingSourcePath })).toBe(
      "frontend",
    );
  });

  it("returns normalized handles and null specialty family when vocabularies are absent", () => {
    expect(normalizeOperatorReviewHandle(" Portal-UX ", { sourcePath: missingSourcePath })).toBe(
      "portal-ux",
    );
    expect(
      deriveOperatorSpecialtyFamily("Frontend — React 19", { sourcePath: missingSourcePath }),
    ).toBeNull();
  });

  it("reports zero stats when vocabulary sources are absent", () => {
    expect(getOperatorCapabilityVocabularyStats({ sourcePath: missingSourcePath })).toEqual({
      canonicalCount: 0,
      aliasCount: 0,
    });
    expect(getOperatorTriggerVocabularyStats({ sourcePath: missingSourcePath })).toEqual({
      canonicalCount: 0,
      aliasCount: 0,
    });
    expect(getOperatorReviewHandleVocabularyStats({ sourcePath: missingSourcePath })).toEqual({
      canonicalCount: 0,
      aliasCount: 0,
    });
    expect(getOperatorSpecialtyFamilyVocabularyStats({ sourcePath: missingSourcePath })).toEqual({
      canonicalCount: 0,
      aliasCount: 0,
    });
  });
});
