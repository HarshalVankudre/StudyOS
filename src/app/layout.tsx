import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Hanken_Grotesk, JetBrains_Mono, Newsreader } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { getI18n } from "@/lib/i18n/server";
import { siteUrl } from "@/lib/site";
import { I18nProvider } from "@/lib/i18n/client";
import { clerkLocalization } from "@/lib/i18n/clerk";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SkipLink } from "@/components/command/SkipLink";

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
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
    // Installed to an iPhone home screen: full screen, titled, black status bar (content
    // stays below it, so no page needs safe-area padding at the top).
    // The manifest itself is app/manifest.ts; the touch icon is app/apple-icon.png.
    appleWebApp: {
      capable: true,
      title: "StudyOS",
      statusBarStyle: "black",
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

/** Browser chrome colour: the app's default dark paper (globals.css --bg). */
export const viewport: Viewport = {
  themeColor: "#0b0b0a",
  colorScheme: "dark light",
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
      className={`${hanken.variable} ${jetbrainsMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <I18nProvider locale={locale} dictionary={dict}>
            <SkipLink />
            <ClerkProvider
              localization={clerkLocalization(locale)}
              // Colours follow the active theme: they read the same CSS
              // tokens as the rest of the app (globals.css, :root and .light).
              appearance={{
                variables: {
                  colorPrimary: "var(--accent)",
                  colorPrimaryForeground: "var(--accent-on)",
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
                  formButtonPrimary: "bg-lime text-lime-on hover:bg-lime-deep",
                  card: "bg-surface border border-line shadow-pop",
                  headerTitle: "font-serif font-bold tracking-tight text-ink",
                  headerSubtitle: "text-ink-soft",
                  socialButtonsBlockButton: "bg-card border border-line-strong text-ink hover:bg-hover",
                  formFieldLabel: "text-ink-soft",
                  footerActionLink: "text-lime hover:text-lime-deep",
                },
              }}
            >
              {children}
            </ClerkProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
