"use client";

import { useActionState } from "react";
import { Loader2Icon } from "lucide-react";
import { createOrganizationAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CURRENCIES } from "@/lib/domain/labels";

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-base font-semibold">Set up your business</h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ll add your Flashforge AD5X and Adventurer 5M printers automatically. You can change everything later in
          Settings.
        </p>
      </div>
      {state && !state.ok && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="name">Business name</Label>
        <Input id="name" name="name" required placeholder="e.g. Taylor Prints" autoComplete="organization" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="currency">Currency</Label>
        <select
          id="currency"
          name="currency"
          defaultValue="GBP"
          className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-start gap-2.5 rounded-md border bg-muted/40 p-3">
        <Checkbox id="demo" name="demo" defaultChecked className="mt-0.5" />
        <div className="space-y-0.5">
          <Label htmlFor="demo">Load demo data</Label>
          <p className="text-xs text-muted-foreground">
            Adds sample products, customers, orders and filament so you can explore. Everything is labelled
            &ldquo;Demo&rdquo; and can be removed in one click from Settings.
          </p>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2Icon className="animate-spin" />}
        {pending ? "Setting up…" : "Continue"}
      </Button>
    </form>
  );
}
