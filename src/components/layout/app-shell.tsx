"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, useState } from "react";
import { LogOutIcon, MenuIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { signOutAction } from "@/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import { NotificationsBell } from "@/components/notifications/notifications-bell";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { MOBILE_TABS, NAV_ITEMS, SECONDARY_NAV, isActive, type NavItem } from "./nav-items";

interface ShellUser {
  name: string;
  email: string | null;
  businessName: string;
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-foreground",
        active && "bg-sidebar-accent text-foreground",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
      {item.label}
    </Link>
  );
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
      <div className="my-2 h-px bg-sidebar-border" />
      {SECONDARY_NAV.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

function UserMenu({ user, compact = false }: { user: ShellUser; compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-md text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60",
            compact ? "p-1" : "w-full p-2",
          )}
          aria-label="Account menu"
        >
          <Avatar name={user.name} />
          {!compact && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.businessName}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"} className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-foreground">{user.name}</span>
          {user.email && <span className="block truncate">{user.email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/activity">Activity log</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            startTransition(() => signOutAction());
          }}
        >
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const tabs = MOBILE_TABS.map((href) => NAV_ITEMS.find((n) => n.href === href)!);
  const moreActive = !MOBILE_TABS.some((h) => isActive(pathname, h));

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center justify-between border-b px-4 pr-2">
          <Link href="/dashboard" aria-label="Dashboard">
            <BrandMark />
          </Link>
          <NotificationsBell />
        </div>
        <div className="px-3 pt-3">
          <Button asChild size="sm" className="w-full">
            <Link href="/orders/new">
              <PlusIcon /> New order
            </Link>
          </Button>
        </div>
        <SidebarNav pathname={pathname} />
        <div className="border-t p-2">
          <UserMenu user={user} />
        </div>
      </aside>

      {/* Mobile navigation drawer */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <div className="flex h-14 items-center border-b px-4">
            <BrandMark />
          </div>
          <SidebarNav pathname={pathname} onNavigate={() => setOpen(false)} />
          <div className="border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <UserMenu user={user} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-56">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon />
          </Button>
          <Link href="/dashboard" className="min-w-0 flex-1">
            <BrandMark />
          </Link>
          <NotificationsBell />
          <Button asChild size="sm">
            <Link href="/orders/new">
              <PlusIcon /> Order
            </Link>
          </Button>
          <UserMenu user={user} compact />
        </header>

        <main id="main" className="flex-1 pb-20 lg:pb-0">
          {children}
        </main>

        {/* Mobile bottom tabs */}
        <nav
          aria-label="Quick navigation"
          className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {tabs.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground",
                  active && "text-primary",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              "flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground",
              moreActive && "text-primary",
            )}
          >
            <MoreHorizontalIcon className="size-5" aria-hidden />
            More
          </button>
        </nav>
      </div>
    </div>
  );
}
