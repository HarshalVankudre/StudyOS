import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { GeneratorClient } from "./GeneratorClient";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.generateTitle };
}

export default function GeneratePage() {
  return <GeneratorClient />;
}
