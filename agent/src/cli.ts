#!/usr/bin/env node
import readline from "node:readline";
import { AgentRevokedError, AGENT_VERSION, PrinterAgent, consoleLogger } from "./agent.js";
import { PrintFlowApi } from "./api.js";
import { configPath, loadConfig, redact, saveConfig, type AgentConfig } from "./config.js";
import { defaultFlashNetworkPaths, FlashNetworkTransport } from "./flashforge/flashnetwork.js";
import { MockPrinterFleet, MockTransport } from "./flashforge/mock.js";
import type { FlashforgeTransport } from "./flashforge/transport.js";
import { startMockControl } from "./mock-control.js";
import { MODEL_LABELS } from "./protocol.js";

const HELP = `PrintFlow Printer Agent ${AGENT_VERSION}

Usage: printflow-agent <command> [options]

  pair --server <url> --code <code> [--name <name>] [--mock]
        Pair this agent with PrintFlow using a one-time code from
        Printers → Agents. Use --mock only for a simulated test setup.
  set-check-code <serial> [code]
        Store a printer's LAN check code ("Printer ID" in the printer's
        network settings) on this computer. Prompts when code is omitted.
  remove-check-code <serial>
  set-library --library <path> --settings <path>
        Location of Flashforge's FlashNetwork library and FLASHNETWORK7.DAT
        (from an Orca-Flashforge installation).
  discover      List Flashforge printers found on the local network.
  status        Show this agent's configuration (secrets hidden).
  run           Start the agent.

Config file: ${configPath()}
`;

function arg(args: string[], name: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function requireConfig(): AgentConfig {
  const c = loadConfig();
  if (!c) {
    console.error("This agent is not paired yet. Run: printflow-agent pair --server <url> --code <code>");
    process.exit(1);
  }
  return c;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(a.trim()))));
}

function transportFor(config: AgentConfig): { transport: FlashforgeTransport; fleet?: MockPrinterFleet } {
  if (config.driver === "mock") {
    const fleet = new MockPrinterFleet([], {
      speed: config.mock?.speed ?? 1,
      printSeconds: config.mock?.printSeconds ?? 60,
      heatingSeconds: 3,
    });
    return { transport: new MockTransport(fleet), fleet };
  }
  const defaults = defaultFlashNetworkPaths();
  const libraryPath = config.flashNetwork?.libraryPath ?? defaults?.libraryPath;
  const serverSettingsPath = config.flashNetwork?.serverSettingsPath ?? defaults?.serverSettingsPath;
  if (!libraryPath || !serverSettingsPath) {
    throw new Error("Set the FlashNetwork library location first: printflow-agent set-library --library <path> --settings <path>");
  }
  return { transport: new FlashNetworkTransport({ libraryPath, serverSettingsPath, logDir: config.flashNetwork?.logDir ?? null }) };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "pair": {
      const server = arg(args, "server");
      const code = arg(args, "code");
      if (!server || !code) throw new Error("Usage: printflow-agent pair --server <url> --code <code>");
      const mock = args.includes("--mock");
      const res = await PrintFlowApi.pair(server, {
        code,
        name: arg(args, "name"),
        version: AGENT_VERSION,
        platform: `${process.platform}-${process.arch}`,
        driver: mock ? "mock" : "flashforge_lan",
      });
      const existing = loadConfig();
      saveConfig({
        serverUrl: server,
        agentId: res.agentId,
        token: res.token,
        driver: mock ? "mock" : "flashforge_lan",
        checkCodes: existing?.checkCodes ?? {},
        flashNetwork: existing?.flashNetwork,
        mock: mock ? existing?.mock ?? {} : undefined,
      });
      console.log(`Paired with ${res.organizationName}. Now add each printer's check code, then run: printflow-agent run`);
      return;
    }
    case "set-check-code": {
      const c = requireConfig();
      const serial = args[0];
      if (!serial) throw new Error("Usage: printflow-agent set-check-code <serial> [code]");
      const code = args[1] ?? (await prompt(`Check code for ${serial}: `));
      if (!code) throw new Error("No check code entered.");
      saveConfig({ ...c, checkCodes: { ...c.checkCodes, [serial]: code } });
      console.log(`Saved the check code for ${serial} (stored only on this computer).`);
      return;
    }
    case "remove-check-code": {
      const c = requireConfig();
      const next = { ...c.checkCodes };
      delete next[args[0]];
      saveConfig({ ...c, checkCodes: next });
      console.log("Removed.");
      return;
    }
    case "set-library": {
      const c = requireConfig();
      saveConfig({ ...c, flashNetwork: { ...c.flashNetwork, libraryPath: arg(args, "library"), serverSettingsPath: arg(args, "settings") } });
      console.log("Saved.");
      return;
    }
    case "status": {
      const c = loadConfig();
      console.log(c ? JSON.stringify(redact(c), null, 2) : "Not paired.");
      return;
    }
    case "discover": {
      const c = requireConfig();
      const { transport } = transportFor(c);
      const list = await transport.discover(2000);
      if (!list.length) console.log("No Flashforge printers answered on this network.");
      for (const d of list) {
        console.log(`${d.serialNumber}  ${d.name}  ${d.ip}:${d.port}  ${d.connectMode === 0 ? "LAN mode" : "cloud mode (switch to LAN mode on the printer)"}`);
      }
      transport.close();
      return;
    }
    case "run": {
      const c = requireConfig();
      const { transport, fleet } = transportFor(c);
      if (fleet) {
        consoleLogger("warn", "MOCK MODE: printers are simulated. Nothing here reflects a real printer.");
        const port = c.mock?.controlPort;
        if (port) startMockControl(fleet, port);
      }
      const api = new PrintFlowApi(c.serverUrl, c.token);
      const agent = new PrinterAgent(c, transport, api);
      if (fleet) {
        // Simulated printers mirror whatever PrintFlow configures, using the local check codes.
        const origTick = agent.tick.bind(agent);
        agent.tick = async () => {
          for (const p of agent.printers) {
            if (p.serialNumber && p.model && !fleet.snapshot(p.serialNumber)) {
              fleet.add({ serialNumber: p.serialNumber, model: p.model, checkCode: c.checkCodes[p.serialNumber] ?? "", ip: p.ipAddress ?? "127.0.0.1", port: p.lanPort ?? 8899, name: `${MODEL_LABELS[p.model]} (simulated)` });
            }
          }
          await origTick();
        };
      }
      const shutdown = () => {
        agent.stop();
        transport.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      consoleLogger("info", `PrintFlow Printer Agent ${AGENT_VERSION} → ${c.serverUrl} (${transport.kind}, library ${transport.libraryVersion() ?? "n/a"})`);
      await agent.run();
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((error) => {
  if (error instanceof AgentRevokedError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error((error as Error).message);
  process.exit(1);
});
