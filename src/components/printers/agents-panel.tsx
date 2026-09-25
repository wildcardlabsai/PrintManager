"use client";

import { useState } from "react";
import { CopyIcon, KeyRoundIcon, Loader2Icon, PlusIcon, ShieldOffIcon } from "lucide-react";
import { toast } from "sonner";
import { createAgentAction, regeneratePairingCodeAction, revokeAgentAction } from "@/actions/printer-agents";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";

function PairingCode({ code, serverUrl }: { code: string; serverUrl: string }) {
  const command = `printflow-agent pair --server ${serverUrl} --code ${code}`;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        One-time pairing code (valid for 15 minutes, shown only now):
        <span className="mt-1 block rounded-md border bg-muted px-3 py-2 text-center font-mono text-xl tracking-widest">{code}</span>
      </p>
      <p className="text-xs text-muted-foreground">On the computer that will run the agent:</p>
      <div className="flex items-start gap-2">
        <code className="flex-1 rounded-md border bg-muted px-2 py-1.5 text-xs break-all">{command}</code>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Copy command"
          onClick={() => navigator.clipboard.writeText(command).then(() => toast.success("Copied"))}
        >
          <CopyIcon />
        </Button>
      </div>
    </div>
  );
}

export function CreateAgentButton({ serverUrl }: { serverUrl: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Workshop computer");
  const [code, setCode] = useState<string | null>(null);
  const { pending, execute } = useAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCode(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> Add Printer Agent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a Printer Agent</DialogTitle>
          <DialogDescription>The agent runs on a computer on the same network as your printers and connects out to PrintFlow.</DialogDescription>
        </DialogHeader>
        {code ? (
          <PairingCode code={code} serverUrl={serverUrl} />
        ) : (
          <Field id="agent-name" label="Name">
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <DialogFooter>
          {code ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button disabled={pending || !name.trim()} onClick={() => execute(() => createAgentAction(name), { success: "", onSuccess: (d) => setCode(d.code) })}>
              {pending && <Loader2Icon className="animate-spin" />} Create pairing code
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentRowActions({ agentId, name, status, serverUrl }: { agentId: string; name: string; status: string; serverUrl: string }) {
  const [code, setCode] = useState<string | null>(null);
  const { pending, execute } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ConfirmButton
        title={status === "active" ? `Re-pair "${name}"?` : `New pairing code for "${name}"`}
        description={
          status === "active"
            ? "The agent's current token stops working immediately. Use this if the computer was replaced or the token may have leaked."
            : "Any earlier pairing code stops working."
        }
        confirmLabel="Create code"
        onConfirm={() => execute(() => regeneratePairingCodeAction(agentId), { success: "", onSuccess: (d) => setCode(d.code) })}
        trigger={
          <Button size="sm" variant="outline" disabled={pending}>
            <KeyRoundIcon /> {status === "active" ? "Re-pair" : "New code"}
          </Button>
        }
      />
      {status !== "revoked" && (
        <ConfirmButton
          title={`Revoke "${name}"?`}
          description="The agent is disconnected at once, queued commands are cancelled and its printers show as not configured. This can't be undone (create a new pairing code to use it again)."
          confirmLabel="Revoke"
          destructive
          onConfirm={() => execute(() => revokeAgentAction(agentId))}
          trigger={
            <Button size="sm" variant="outline" className="text-destructive" disabled={pending}>
              <ShieldOffIcon /> Revoke
            </Button>
          }
        />
      )}
      <Dialog open={Boolean(code)} onOpenChange={(o) => !o && setCode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pair “{name}”</DialogTitle>
            <DialogDescription>Run this on the agent&apos;s computer.</DialogDescription>
          </DialogHeader>
          {code && <PairingCode code={code} serverUrl={serverUrl} />}
          <DialogFooter>
            <Button onClick={() => setCode(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
