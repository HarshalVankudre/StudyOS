import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 py-12 antialiased">
      <Link
        href="/"
        className="mb-8 flex items-center gap-1.5 font-display text-2xl font-extrabold tracking-tight text-ink"
      >
        StudyOS
        <span className="mb-3 h-2 w-2 rounded-full bg-lime" aria-hidden />
      </Link>
      <SignUp />
    </main>
  );
}
