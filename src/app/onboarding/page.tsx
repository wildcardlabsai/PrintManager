import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { getSessionUser, loadAppContext } from "@/lib/services/context";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  if (!(await getSessionUser())) redirect("/login");
  if (await loadAppContext()) redirect("/dashboard");
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandMark className="text-lg" />
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-xs">
          <OnboardingForm />
        </div>
      </div>
    </div>
  );
}
