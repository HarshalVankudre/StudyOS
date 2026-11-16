import type { Metadata } from "next";
import { NoticePage, noticeMetadata } from "@/components/contract-notices/NoticePage";

/** "Cancel contracts here": the cancellation button (§ 312k BGB). Public, signed out included. */
export async function generateMetadata(): Promise<Metadata> {
  return noticeMetadata("cancellation");
}

export default async function CancelPage() {
  return <NoticePage kind="cancellation" />;
}
