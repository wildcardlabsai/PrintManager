import type { LiveChecklist, LiveChecklistEntry } from "@/types/db";

/**
 * The live test checklist a printer must pass before PrintFlow sends it
 * production jobs. Steps PrintFlow can observe are ticked from real telemetry;
 * the rest need a person who is standing at the printer.
 */
export interface ChecklistStep {
  key: string;
  label: string;
  how: "observed" | "confirm";
  help: string;
}

export const LIVE_CHECKLIST: ChecklistStep[] = [
  { key: "connect", label: "Connect", how: "observed", help: "The agent reached the printer with its serial number and check code." },
  { key: "read_status", label: "Read status", how: "observed", help: "PrintFlow received the printer's status." },
  { key: "verify_identity", label: "Verify identity", how: "confirm", help: "The name, serial number and IP shown match the printer in front of you." },
  { key: "firmware", label: "Read firmware", how: "observed", help: "The printer reported its firmware version." },
  { key: "capabilities", label: "Read capabilities", how: "observed", help: "A connection test read the printer's controls." },
  { key: "test_print", label: "Send a harmless test print", how: "observed", help: "A small test file was accepted by the printer while someone watched it." },
  { key: "status_during_print", label: "Status during print", how: "observed", help: "PrintFlow saw the printer printing." },
  { key: "progress", label: "Progress", how: "observed", help: "Progress was reported during the print." },
  { key: "completion", label: "Completion", how: "observed", help: "PrintFlow saw the print finish." },
  { key: "job_update", label: "Verify PrintFlow updated correctly", how: "confirm", help: "The print came out right and PrintFlow's record matches what happened." },
];

export function checklistComplete(c: LiveChecklist) {
  return LIVE_CHECKLIST.every((s) => c[s.key]);
}

/** Entries recorded from a simulator don't count for a real printer. */
export function checklistFromRealPrinter(c: LiveChecklist) {
  return LIVE_CHECKLIST.every((s) => c[s.key] && c[s.key]!.source !== "mock");
}

export interface Observation {
  connected?: boolean;
  status?: boolean;
  firmware?: string | null;
  capabilities?: boolean;
  testPrintAccepted?: boolean;
  printing?: boolean;
  progress?: boolean;
  completed?: boolean;
}

/** Adds newly observed steps. Returns null when nothing changed. */
export function applyObservations(
  current: LiveChecklist,
  obs: Observation,
  source: "flashforge_lan" | "mock",
  at: string,
): LiveChecklist | null {
  const next: LiveChecklist = { ...current };
  let changed = false;
  const mark = (key: string, ok: boolean | undefined, note?: string | null) => {
    if (!ok) return;
    const existing = next[key];
    // A real observation replaces a simulated one; otherwise keep the first.
    if (existing && !(existing.source === "mock" && source !== "mock")) return;
    next[key] = { at, by: null, source, note: note ?? null } satisfies LiveChecklistEntry;
    changed = true;
  };
  mark("connect", obs.connected);
  mark("read_status", obs.status);
  mark("firmware", Boolean(obs.firmware), obs.firmware);
  mark("capabilities", obs.capabilities);
  mark("test_print", obs.testPrintAccepted);
  // Print observations only count once a test print has been sent.
  if (next.test_print) {
    mark("status_during_print", obs.printing);
    mark("progress", obs.progress);
    mark("completion", obs.completed);
  }
  return changed ? next : null;
}

/** When a printer switches from simulated to real telemetry, simulated ticks are dropped. */
export function dropSimulated(c: LiveChecklist): LiveChecklist {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v && v.source !== "mock"));
}
