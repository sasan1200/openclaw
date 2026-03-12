import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveOperatorReferenceSourcePath } from "./reference-paths.js";

describe("operator reference paths", () => {
  it("resolves reference files under the workspace memory directory", () => {
    expect(
      resolveOperatorReferenceSourcePath("operator-specialty-family-vocabulary.yaml", {
        workspaceDir: "/tmp/tonya-home",
      }),
    ).toBe(
      path.join(
        "/tmp/tonya-home",
        "memory",
        "reference",
        "operator-specialty-family-vocabulary.yaml",
      ),
    );
  });

  it("honors an explicit source path override", () => {
    expect(
      resolveOperatorReferenceSourcePath("ignored.yaml", {
        sourcePath: "/tmp/custom/operator-review-handle-vocabulary.yaml",
      }),
    ).toBe(path.resolve("/tmp/custom/operator-review-handle-vocabulary.yaml"));
  });
});
