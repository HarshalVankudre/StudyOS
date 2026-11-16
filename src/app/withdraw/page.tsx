import type { Metadata } from "next";
import { NoticePage, noticeMetadata } from "@/components/contract-notices/NoticePage";

/** "Withdraw from contract here": the electronic withdrawal function (§ 356a BGB). Public, signed out included. */
export async function generateMetadata(): Promise<Metadata> {
  return noticeMetadata("withdrawal");
}

export default async function WithdrawPage() {
  return <NoticePage kind="withdrawal" />;
}
