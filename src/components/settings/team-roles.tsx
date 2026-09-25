"use client";

import { setMemberRoleAction } from "@/actions/team";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/printers/permissions";
import type { MemberRole } from "@/types/db";

export function RoleSelect({ userId, role, disabled }: { userId: string; role: MemberRole; disabled: boolean }) {
  const { pending, execute } = useAction();
  if (role === "owner" || disabled) return <span className="text-[13px]">{ROLE_LABELS[role]}</span>;
  return (
    <Select value={role} disabled={pending} onValueChange={(v) => execute(() => setMemberRoleAction(userId, v))}>
      <SelectTrigger size="sm" className="w-36" aria-label="Role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(["admin", "staff", "viewer"] as const).map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RoleLegend() {
  return (
    <dl className="grid gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
      {(["owner", "admin", "staff", "viewer"] as const).map((r) => (
        <div key={r} className="contents">
          <dt className="font-medium">{ROLE_LABELS[r]}</dt>
          <dd className="text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</dd>
        </div>
      ))}
    </dl>
  );
}
