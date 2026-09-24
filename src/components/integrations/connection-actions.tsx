"use client";

import { Loader2Icon, PlugIcon, RefreshCwIcon, UnplugIcon } from "lucide-react";
import { disconnectAction, syncNowAction } from "@/actions/integrations";
import { ConfirmButton } from "@/components/shared/confirm-button";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import type { ConnectionStatus } from "@/lib/services/integrations/types";

/** Only the actions that make sense for the current state are rendered. */
export function MarketplaceConnectionActions({
  provider,
  name,
  status,
  configured,
}: {
  provider: "etsy" | "ebay";
  name: string;
  status: ConnectionStatus | null;
  configured: boolean;
}) {
  const { pending, execute } = useAction();
  const connected = status === "connected" || status === "error" || status === "restricted";
  const needsAuth = status === "auth_required";
  return (
    <div className="flex flex-wrap gap-2">
      {!status || status === "disconnected" ? (
        configured ? (
          <Button asChild size="sm">
            <a href={`/api/integrations/${provider}/connect`}>
              <PlugIcon /> Connect {name}
            </a>
          </Button>
        ) : (
          <Button size="sm" disabled title="Server configuration missing">
            <PlugIcon /> Connect {name}
          </Button>
        )
      ) : null}
      {(needsAuth || connected) && configured && (
        <Button asChild size="sm" variant={needsAuth ? "default" : "outline"}>
          <a href={`/api/integrations/${provider}/connect`}>
            <PlugIcon /> Reconnect
          </a>
        </Button>
      )}
      {connected && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => execute(() => syncNowAction(provider), { success: (d) => d.message })}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Sync {name} now
        </Button>
      )}
      {status && status !== "disconnected" && (
        <ConfirmButton
          title={`Disconnect ${name}?`}
          description={`PrintFlow deletes its stored ${name} tokens and stops syncing. Imported orders stay. To fully revoke access, also remove PrintFlow from your ${name} account's connected apps.`}
          confirmLabel="Disconnect"
          destructive
          onConfirm={() => execute(() => disconnectAction(provider))}
          trigger={
            <Button size="sm" variant="ghost" className="text-destructive">
              <UnplugIcon /> Disconnect
            </Button>
          }
        />
      )}
    </div>
  );
}
