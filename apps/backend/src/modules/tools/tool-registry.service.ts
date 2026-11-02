import type { OperationRequest, Permission } from "../../../../../packages/protocol/src/index.js";

export interface ToolDefinition {
  name: string;
  description: string;
  operation: OperationRequest["operation"];
  permission: Permission;
  requiredInput: string[];
}

const DEFINITIONS: ToolDefinition[] = [
  { name: "system_info", description: "Read basic information about the connected machine.", operation: "system.info", permission: "connector.health", requiredInput: [] },
  { name: "list_files", description: "List files and directories inside an allowed Connector root.", operation: "filesystem.list", permission: "filesystem.read", requiredInput: ["path"] },
  { name: "read_file", description: "Read a text file inside an allowed Connector root.", operation: "filesystem.read", permission: "filesystem.read", requiredInput: ["path"] },
  { name: "write_file", description: "Write a text file inside an allowed Connector root.", operation: "filesystem.write", permission: "filesystem.write", requiredInput: ["path", "content"] },
  { name: "terminal_execute", description: "Execute an allowlisted terminal command on the connected machine.", operation: "terminal.execute", permission: "terminal.execute", requiredInput: ["command"] },
  { name: "process_list", description: "List processes on the connected machine.", operation: "process.list", permission: "process.manage", requiredInput: [] },
  { name: "browser_open", description: "Open a browser session on a graphical Connector.", operation: "browser.open", permission: "browser.use", requiredInput: [] },
  { name: "browser_navigate", description: "Navigate an existing browser session.", operation: "browser.navigate", permission: "browser.use", requiredInput: ["sessionId", "url"] },
  { name: "collect_artifacts", description: "Collect metadata for files below an allowed root.", operation: "artifact.collect", permission: "filesystem.read", requiredInput: ["path"] },
];

export class ToolRegistryService {
  list(): ToolDefinition[] { return DEFINITIONS.map((definition) => ({ ...definition, requiredInput: [...definition.requiredInput] })); }

  get(name: string): ToolDefinition | null { return DEFINITIONS.find((definition) => definition.name === name) ?? null; }

  validate(definition: ToolDefinition, input: Record<string, unknown>): void {
    const missing = definition.requiredInput.filter((key) => {
      const value = input[key];
      return value === undefined || value === null || (typeof value === "string" && !value.trim());
    });
    if (missing.length) throw new Error(`TOOL_INPUT_REQUIRED:${missing.join(",")}`);
  }
}
