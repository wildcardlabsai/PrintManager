import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-20 text-center">
      <h1 className="text-base font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">That record doesn&apos;t exist or you don&apos;t have access to it.</p>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
