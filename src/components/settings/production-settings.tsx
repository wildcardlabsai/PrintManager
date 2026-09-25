"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { updateProductionSettingsAction } from "@/actions/settings";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import type { Settings } from "@/types/db";

/**
 * Settings → Production. The automatic print queue is OFF by default and
 * turning it on needs an explicit confirmation of what it will do.
 */
export function ProductionSettings({ settings, canEdit }: { settings: Settings; canEdit: boolean }) {
  const [auto, setAuto] = useState(settings.auto_print_enabled);
  const [offline, setOffline] = useState(String(settings.printer_offline_after_seconds));
  const [timeout, setTimeoutValue] = useState(String(settings.printer_command_timeout_seconds));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, execute } = useAction();

  async function save(nextAuto = auto) {
    const r = await execute(() =>
      updateProductionSettingsAction({ auto_print_enabled: nextAuto, printer_offline_after_seconds: offline, printer_command_timeout_seconds: timeout }),
    );
    if (r.ok) {
      setAuto(nextAuto);
      setErrors({});
    } else setErrors(r.fieldErrors ?? {});
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="auto-print">Automatic print queue</Label>
          <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
            {auto ? "ON" : "OFF"} — when on, PrintFlow starts the next job on a connected printer by itself, but only if every check passes: the
            printer is verified, idle, reporting live, its plate was confirmed clear, the job was assigned to it by a person, the file is proven and
            single-colour, the loaded filament matches, the order is paid, and it&apos;s the job&apos;s first attempt. Anything else waits for a person.
            Failed prints are never retried automatically.
          </p>
        </div>
        {canEdit &&
          (auto ? (
            <Switch id="auto-print" checked onCheckedChange={() => save(false)} disabled={pending} />
          ) : (
            <ConfirmButton
              title="Turn on the automatic print queue?"
              description="Printers will start eligible jobs without anyone pressing Start. Make sure someone clears finished prints and confirms the plate is clear in PrintFlow — that confirmation is what lets the next job start."
              confirmLabel="Turn on"
              onConfirm={() => save(true)}
              trigger={<Switch id="auto-print" checked={false} disabled={pending} />}
            />
          ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="offline-after"
          label="Mark a printer offline after (seconds)"
          error={errors.printer_offline_after_seconds}
          hint="Needs 3 failed status checks in a row as well, so one dropped request never marks a printer offline."
        >
          <Input id="offline-after" inputMode="numeric" value={offline} onChange={(e) => setOffline(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field
          id="cmd-timeout"
          label="Command timeout (seconds)"
          error={errors.printer_command_timeout_seconds}
          hint="A print the agent hasn't picked up by then is cancelled rather than started late."
        >
          <Input id="cmd-timeout" inputMode="numeric" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} disabled={!canEdit} />
        </Field>
      </div>
      {canEdit && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => save()}>
          {pending && <Loader2Icon className="animate-spin" />}
          Save production settings
        </Button>
      )}
    </div>
  );
}
