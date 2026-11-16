import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { getI18n } from "@/lib/i18n/server";
import { siteUrl } from "@/lib/site";
import { I18nProvider } from "@/lib/i18n/client";
import { clerkLocalization } from "@/lib/i18n/clerk";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SkipLink } from "@/components/command/SkipLink";
import { SignedOutPushGuard } from "@/components/notifications/SignedOutPushGuard";

// These three are the fallback families: globals.css puts Anthropic Serif
// (headings), Sans and Mono first, from local files that are not deployed.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return {
    metadataBase: new URL(siteUrl()),
    title: dict.meta.homeTitle,
    description: dict.meta.homeDescription,
    applicationName: "StudyOS",
    // Installed to an iPhone home screen: full screen, titled, standard status bar (content
    // stays below it, so no page needs safe-area padding at the top).
    // The manifest itself is app/manifest.ts; the touch icon is app/apple-icon.png.
    appleWebApp: {
      capable: true,
      title: "StudyOS",
      statusBarStyle: "default",
    },
    formatDetection: { telephone: false },
    openGraph: {
      title: dict.meta.homeTitle,
      description: dict.meta.homeDescription,
      url: "/",
      siteName: "StudyOS",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: dict.meta.homeTitle,
      description: dict.meta.homeDescription,
    },
  };
}

/** Browser chrome colour: the app's default paper background (globals.css --bg). */
export const viewport: Viewport = {
  themeColor: "#faf9f5",
  colorScheme: "light dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, dir, dict } = await getI18n();

  return (
    <html
      lang={locale}
      dir={dir}
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <I18nProvider locale={locale} dictionary={dict}>
            <SkipLink />
            <ClerkProvider
              localization={clerkLocalization(locale)}
              // Colours follow the active theme: they read the same CSS
              // tokens as the rest of the app (globals.css, :root and .dark).
              appearance={{
                variables: {
                  colorPrimary: "var(--accent-deep)",
                  colorPrimaryForeground: "var(--bg)",
                  colorBackground: "var(--surface)",
                  colorForeground: "var(--text)",
                  colorMutedForeground: "var(--text-soft)",
                  colorNeutral: "var(--text)",
                  colorInput: "var(--card)",
                  colorInputForeground: "var(--text)",
                  colorBorder: "var(--border-strong-c)",
                  colorDanger: "var(--destructive)",
                  borderRadius: "0.625rem",
                  fontSize: "14px",
                },
                elements: {
                  formButtonPrimary: "bg-lime text-lime-on hover:bg-lime-hover rounded-full shadow-none",
                  card: "bg-card border border-line shadow-none rounded-3xl",
                  headerTitle: "font-display font-bold tracking-tight text-ink",
                  headerSubtitle: "text-ink-soft",
                  socialButtonsBlockButton: "bg-card border border-line-strong text-ink hover:bg-hover",
                  formFieldLabel: "text-ink-soft",
                  footerActionLink: "text-lime-deep underline underline-offset-4 hover:text-ink",
                },
              }}
            >
              <SignedOutPushGuard />
              {children}
            </ClerkProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
