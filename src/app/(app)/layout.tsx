import { AppShell } from "@/components/layout/app-shell";
import { requirePageContext } from "@/lib/services/context";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requirePageContext();
  return (
    <AppShell
      user={{
        name: ctx.fullName || ctx.email || "Account",
        email: ctx.email,
        businessName: ctx.settings.business_name,
      }}
    >
      {children}
    </AppShell>
  );
}
