import type { Metadata } from "next";
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

  return <GeneratorClient initialPrompt={initialPrompt} />;
}
