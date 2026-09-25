import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentDriver } from "./protocol.js";

/**
 * Local agent configuration. Holds the agent token and the printers' LAN
 * check codes, so it is written owner-read/write only (0600). The check codes
 * never leave this machine.
 */
export interface AgentConfig {
  serverUrl: string;
  agentId: string;
  token: string;
  driver: AgentDriver;
  flashNetwork?: { libraryPath?: string; serverSettingsPath?: string; logDir?: string | null };
  /** serial number → check code ("Printer ID" in the printer's network settings) */
  checkCodes: Record<string, string>;
  mock?: { printSeconds?: number; speed?: number; controlPort?: number | null };
}

export function configPath() {
  return process.env.PRINTFLOW_AGENT_CONFIG ?? path.join(os.homedir(), ".printflow-agent", "config.json");
}

export function loadConfig(file = configPath()): AgentConfig | null {
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AgentConfig>;
  if (!raw.serverUrl || !raw.agentId || !raw.token) return null;
  return { driver: "flashforge_lan", checkCodes: {}, ...raw } as AgentConfig;
}

export function saveConfig(config: AgentConfig, file = configPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows: permissions come from the user profile directory.
  }
}

export function redact(config: AgentConfig) {
  return {
    ...config,
    token: config.token ? `${config.token.slice(0, 8)}…` : "",
    checkCodes: Object.fromEntries(Object.keys(config.checkCodes).map((k) => [k, "••••••••"])),
  };
}
