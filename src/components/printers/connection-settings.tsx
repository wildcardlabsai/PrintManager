"use client";

import { useState } from "react";
import { Loader2Icon, SettingsIcon } from "lucide-react";
import { configurePrinterConnectionAction } from "@/actions/printers";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import type { Printer, PrinterAgent } from "@/types/db";

/** Admin-only: how PrintFlow reaches this printer. The LAN check code is entered on the agent, never here. */
export function ConnectionSettingsDialog({
  printer,
  agents,
  supported,
}: {
  printer: Printer;
  agents: Pick<PrinterAgent, "id" | "name" | "status">[];
  supported: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(printer.connection_mode);
  const [agentId, setAgentId] = useState(printer.agent_id ?? "");
  const [multi, setMulti] = useState(printer.multi_colour);
  const [camera, setCamera] = useState(printer.camera);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, execute } = useAction();
  const usable = agents.filter((a) => a.status !== "revoked");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const r = await execute(() =>
      configurePrinterConnectionAction(printer.id, {
        connection_mode: mode,
        agent_id: mode === "agent_lan" ? agentId : null,
        serial_number: f.serial_number,
        ip_address: f.ip_address,
        lan_port: f.lan_port,
        multi_colour: multi,
        colour_channels: multi ? f.colour_channels : 1,
        camera,
      }),
    );
    if (r.ok) {
      setOpen(false);
      setErrors({});
    } else setErrors(r.fieldErrors ?? {});
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <SettingsIcon /> Connection settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connection for {printer.name}</DialogTitle>
          <DialogDescription>
            Changing the agent, serial number or address resets the live test checklist. The printer&apos;s check code is stored only on the Printer
            Agent&apos;s computer.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <Field id="cs-mode" label="Connection">
            <Select value={mode} onValueChange={(v) => setMode(v as Printer["connection_mode"])}>
              <SelectTrigger id="cs-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual (status set by hand)</SelectItem>
                <SelectItem value="agent_lan" disabled={!supported}>
                  Printer Agent — Flashforge LAN{!supported ? " (AD5X / Adventurer 5M only)" : ""}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {mode === "agent_lan" && (
            <>
              <Field id="cs-agent" label="Printer Agent" required error={errors.agent_id} hint={!usable.length ? "Create an agent under Printers → Printer Agents first." : undefined}>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger id="cs-agent">
                    <SelectValue placeholder="Choose an agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {usable.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                        {a.status === "pending" ? " (not paired yet)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="cs-sn" label="Serial number" required error={errors.serial_number} hint="As shown on the printer (starts with SN). Run “printflow-agent discover” to list printers.">
                <Input id="cs-sn" name="serial_number" defaultValue={printer.serial_number ?? ""} className="font-mono" autoComplete="off" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="cs-ip" label="IP address" error={errors.ip_address} hint="Optional — found by discovery if blank">
                  <Input id="cs-ip" name="ip_address" defaultValue={printer.ip_address ?? ""} placeholder="192.168.1.50" className="font-mono" />
                </Field>
                <Field id="cs-port" label="LAN port" error={errors.lan_port} hint="Optional — from discovery">
                  <Input id="cs-port" name="lan_port" inputMode="numeric" defaultValue={printer.lan_port ?? ""} className="font-mono" />
                </Field>
              </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <Checkbox id="cs-multi" checked={multi} onCheckedChange={(v) => setMulti(v === true)} />
            <Label htmlFor="cs-multi" className="font-normal">
              Multi-colour capable (e.g. AD5X with IFS)
            </Label>
          </div>
          {multi && (
            <Field id="cs-ch" label="Colour channels" error={errors.colour_channels}>
              <Input id="cs-ch" name="colour_channels" inputMode="numeric" defaultValue={printer.colour_channels} className="w-24" />
            </Field>
          )}
          <Field id="cs-cam" label="Camera" hint="PrintFlow only shows a camera stream if the printer itself reports one.">
            <Select value={camera} onValueChange={(v) => setCamera(v as Printer["camera"])}>
              <SelectTrigger id="cs-cam">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">Unknown</SelectItem>
                <SelectItem value="none">No camera</SelectItem>
                <SelectItem value="built_in">Built-in camera</SelectItem>
                <SelectItem value="optional">Optional camera fitted</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
