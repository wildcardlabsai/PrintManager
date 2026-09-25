/**
 * Printer integrations.
 *
 * Printers sit on the business's local network, which a cloud-hosted app
 * can't reach. The adapters therefore run inside the PrintFlow Printer Agent
 * (`agent/`), and the app talks to them only through the agent protocol:
 *
 *   browser → server action (auth + permission + validation)
 *           → printer_commands (whitelisted command)  → agent heartbeat
 *           → PrinterIntegration adapter              → printer (LAN)
 *
 * The adapter contract and the Flashforge AD5X / Adventurer 5M adapters live
 * in agent/src/integration.ts and agent/src/flashforge/. They are re-exported
 * here for reference and tests.
 */
export type {
  AgentCommand,
  AgentErrorCode,
  Capability,
  PrinterModelKey,
  PrinterReport,
  PrinterTelemetry,
} from "../../../../agent/src/protocol";
export { MODEL_CAPABILITIES, detectModel } from "../../../../agent/src/protocol";
