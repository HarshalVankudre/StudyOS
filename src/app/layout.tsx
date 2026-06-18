import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Hanken_Grotesk, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { clerkLocalization } from "@/lib/i18n/clerk";
import { ThemeProvider } from "@/components/ThemeProvider";

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
    title: dict.meta.homeTitle,
    description: dict.meta.homeDescription,
  };
}

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
            <ClerkProvider
              localization={clerkLocalization(locale)}
              appearance={{ variables: { colorPrimary: "#1a1a17" } }}
            >
              {children}
            </ClerkProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
