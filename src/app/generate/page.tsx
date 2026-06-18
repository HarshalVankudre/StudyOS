import type { Metadata } from "next";
import { GeneratorClient } from "./GeneratorClient";

export const metadata: Metadata = {
  title: "Generate your workspace · StudyOS",
};

export default function GeneratePage() {
  return <GeneratorClient />;
}
