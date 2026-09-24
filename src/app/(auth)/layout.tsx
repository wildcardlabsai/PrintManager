import { BrandMark } from "@/components/brand-mark";
import { brand } from "@/config/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BrandMark className="text-lg" />
          <p className="text-xs text-muted-foreground">{brand.tagline}</p>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-xs">{children}</div>
      </div>
    </div>
  );
}
