"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BellIcon, CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { markNotificationsReadAction, notificationsAction } from "@/actions/notifications";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { NotificationWithRead } from "@/lib/services/notifications";
import { cn } from "@/lib/utils";

const ICONS = { info: InfoIcon, warning: TriangleAlertIcon, error: CircleAlertIcon, success: CircleCheckIcon };
const TONES = { info: "text-blue-600", warning: "text-amber-600", error: "text-red-600", success: "text-emerald-600" };

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** In-app notifications (printer offline, print finished or failed, send failures). */
export function NotificationsBell({ className }: { className?: string }) {
  const [items, setItems] = useState<NotificationWithRead[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await notificationsAction();
      if (r.ok) {
        setItems(r.data.items);
        setUnread(r.data.unread);
      }
    } catch {
      // offline: keep what we have
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      await load();
    } else {
      const ids = items.filter((i) => !i.read).map((i) => i.id);
      if (ids.length) {
        await markNotificationsReadAction(ids);
        setItems((prev) => prev.map((i) => ({ ...i, read: true })));
        setUnread(0);
      }
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("relative", className)} aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"}>
          <BellIcon />
          {unread > 0 && (
            <span className="tabular absolute top-1 right-1 min-w-4 rounded-full bg-red-600 px-1 text-[10px] leading-4 font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1rem))] p-0">
        <div className="border-b px-3 py-2 text-sm font-semibold">Notifications</div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => {
              const Icon = ICONS[n.severity];
              const body = (
                <div className={cn("flex gap-2.5 px-3 py-2.5 text-[13px]", !n.read && "bg-primary/5")}>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", TONES[n.severity])} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{ago(n.created_at)}</p>
                  </div>
                </div>
              );
              return (
                <li key={n.id}>
                  {n.link ? (
                    <Link href={n.link} onClick={() => onOpenChange(false)} className="block hover:bg-muted/60">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
