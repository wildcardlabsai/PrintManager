import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-xs font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-foreground/80",
        blue: "border-blue-200 bg-blue-50 text-blue-800",
        green: "border-emerald-200 bg-emerald-50 text-emerald-800",
        amber: "border-amber-200 bg-amber-50 text-amber-800",
        red: "border-red-200 bg-red-50 text-red-800",
        violet: "border-indigo-200 bg-indigo-50 text-indigo-800",
        cyan: "border-cyan-200 bg-cyan-50 text-cyan-800",
        slate: "border-slate-300 bg-slate-100 text-slate-700",
        outline: "border-border bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
