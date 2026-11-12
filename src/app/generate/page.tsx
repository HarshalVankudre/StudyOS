import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { hasCredits } from "@/lib/credits";
import { getI18n } from "@/lib/i18n/server";
import { GeneratorClient } from "./GeneratorClient";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.generateTitle };
}

export default async function GeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string | string[] }>;
}) {
  const value = (await searchParams).prompt;
  const initialPrompt = typeof value === "string" ? value.slice(0, 2000) : "";

  // Tell the student they are out of credits BEFORE they describe their
  // studies and answer questions, not after. A failed lookup never blocks.
  const { userId } = await auth();
  const outOfCredits = userId
    ? !(await hasCredits(userId).catch(() => true))
    : false;

  return <GeneratorClient initialPrompt={initialPrompt} outOfCredits={outOfCredits} />;
}
