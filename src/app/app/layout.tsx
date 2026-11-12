import { AppShell } from "@/components/command/AppShell";

/**
 * Shared chrome for every signed-in /app page: the search and command
 * palette (⌘/Ctrl+K), the keyboard shortcut sheet (?), the install hint and
 * the offline service worker. Adds no layout of its own, so each page keeps
 * full control of its frame.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AppShell />
    </>
  );
}
