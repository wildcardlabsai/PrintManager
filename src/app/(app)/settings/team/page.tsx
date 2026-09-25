import type { Metadata } from "next";
import { RoleLegend, RoleSelect } from "@/components/settings/team-roles";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/domain/dates";
import { hasPermission, requirePageContext } from "@/lib/services/context";
import { listTeam } from "@/lib/services/team";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requirePageContext();
  const team = await listTeam(ctx);
  const canManage = hasPermission(ctx, "manage_team");
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Team" description="Who can see and do what in this business." />
      <PageBody className="max-w-4xl">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Member since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell>
                    {m.name ?? "Team member"}
                    {m.user_id === ctx.userId && <span className="text-muted-foreground"> (you)</span>}
                  </TableCell>
                  <TableCell>
                    <RoleSelect userId={m.user_id} role={m.role} disabled={!canManage || m.user_id === ctx.userId} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(m.created_at, ctx.settings.timezone)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <RoleLegend />
            <p className="text-xs text-muted-foreground">
              Inviting new people isn&apos;t built yet; people who already have a PrintFlow membership in this business appear here.
            </p>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
