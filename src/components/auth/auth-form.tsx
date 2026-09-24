"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2Icon } from "lucide-react";
import type { AuthState } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Field = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: React.ReactNode;
};

export function AuthForm({
  title,
  description,
  action,
  fields,
  submitLabel,
  footer,
  hidden,
  notice,
}: {
  title: string;
  description?: string;
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  fields: Field[];
  submitLabel: string;
  footer?: React.ReactNode;
  hidden?: Record<string, string>;
  notice?: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const info = state?.ok ? state.data?.info : null;

  return (
    <form action={formAction} className="space-y-4" noValidate={false}>
      <div className="space-y-1">
        <h1 className="text-base font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {notice && !state && (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
      )}
      {state && !state.ok && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {info ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {info}
        </p>
      ) : (
        <>
          {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {fields.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={f.name}>{f.label}</Label>
                {f.hint}
              </div>
              <Input
                id={f.name}
                name={f.name}
                type={f.type ?? "text"}
                autoComplete={f.autoComplete}
                placeholder={f.placeholder}
                required
              />
            </div>
          ))}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            {submitLabel}
          </Button>
        </>
      )}
      {footer && <div className="pt-1 text-center text-sm text-muted-foreground">{footer}</div>}
    </form>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-primary hover:underline">
      {children}
    </Link>
  );
}
