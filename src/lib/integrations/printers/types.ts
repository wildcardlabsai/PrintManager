import type { PrinterStatus } from "@/types/db";

/**
 * Live printer telemetry, as a Phase 3 adapter would report it. Phase 1
 * never produces this: printer status is entered manually.
 */
export interface PrinterTelemetry {
  status: PrinterStatus;
  currentJobRef?: string | null;
  progressPercent?: number | null;
  remainingMinutes?: number | null;
  nozzleTempC?: number | null;
  bedTempC?: number | null;
  errorMessage?: string | null;
  reportedAt: string;
}

export interface PrinterIntegration {
  readonly id: string;
  /** Printer models this adapter can drive, e.g. ["AD5X", "Adventurer 5M"]. */
  readonly supportedModels: string[];
  getTelemetry(device: { ipAddress: string | null; deviceId: string | null }): Promise<PrinterTelemetry>;
  /** Where supported: upload and start a print. Returns the printer-side job reference. */
  startJob?(device: { ipAddress: string | null; deviceId: string | null }, file: { name: string; url: string }): Promise<string>;
  pauseJob?(device: { ipAddress: string | null; deviceId: string | null }): Promise<void>;
  cancelJob?(device: { ipAddress: string | null; deviceId: string | null }): Promise<void>;
}
