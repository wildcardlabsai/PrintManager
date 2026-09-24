"use client";

import { useState } from "react";
import { Loader2Icon, UnplugIcon } from "lucide-react";
import { connectRoyalMailAction, disconnectAction } from "@/actions/integrations";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";

export function RoyalMailConnect({ connected, configured, oba }: { connected: boolean; configured: boolean; oba: boolean }) {
  const { pending, execute } = useAction();
  const [editing, setEditing] = useState(!connected);
  const [apiKey, setApiKey] = useState("");
  const [isOba, setIsOba] = useState(oba);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          Replace API key
        </Button>
        <ConfirmButton
          title="Disconnect Royal Mail Click & Drop?"
          description="PrintFlow deletes the stored API key. Existing labels and tracking numbers stay on your orders."
          confirmLabel="Disconnect"
          destructive
          onConfirm={() => execute(() => disconnectAction("royal_mail_click_drop"))}
          trigger={
            <Button size="sm" variant="ghost" className="text-destructive">
              <UnplugIcon /> Disconnect
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await execute(() => connectRoyalMailAction({ apiKey, oba: isOba }));
        if (r.ok) {
          setApiKey("");
          setEditing(false);
          setError(null);
        } else setError(r.error);
      }}
    >
      <Field id="rm-key" label="Click & Drop API key" error={error} hint="Click & Drop → Settings → Integrations → Click & Drop API. Stored encrypted; never shown again.">
        <Input id="rm-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={!configured} />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={isOba} onCheckedChange={(c) => setIsOba(Boolean(c))} className="mt-0.5" />
        <span>
          My account is a Royal Mail Online Business Account (OBA)
          <span className="block text-xs text-muted-foreground">OBA accounts can receive printable label PDFs through the API. Other accounts buy and print postage in Click & Drop.</span>
        </span>
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !apiKey || !configured}>
          {pending && <Loader2Icon className="animate-spin" />} Test &amp; connect
        </Button>
        {connected && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
