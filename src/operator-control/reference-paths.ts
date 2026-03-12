import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";

export function resolveOperatorReferenceSourcePath(
  filename: string,
  params?: {
    workspaceDir?: string;
    sourcePath?: string;
  },
): string {
  if (params?.sourcePath?.trim()) {
    return path.resolve(params.sourcePath);
  }
  const workspaceDir =
    params?.workspaceDir?.trim() ||
    resolveAgentWorkspaceDir(loadConfig(), resolveDefaultAgentId(loadConfig()));
  return path.join(workspaceDir, "memory", "reference", filename);
}
