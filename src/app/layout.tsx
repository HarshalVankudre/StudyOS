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
              appearance={{
                variables: {
                  colorPrimary: "#2dd4bf",
                  colorPrimaryForeground: "#0b0b0a",
                  colorBackground: "#131312",
                  colorForeground: "#f4f3ef",
                  colorMutedForeground: "#a8a89e",
                  colorInput: "#171715",
                  colorInputForeground: "#f4f3ef",
                  colorBorder: "rgba(255,255,255,0.14)",
                  colorDanger: "#f87171",
                  borderRadius: "0.625rem",
                  fontSize: "14px",
                },
                elements: {
                  formButtonPrimary:
                    "bg-[#2dd4bf] text-[#0b0b0a] hover:bg-[#14b8a6]",
                  card:
                    "bg-[#131312] border border-[rgba(255,255,255,0.08)] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)]",
                  headerTitle: "font-serif font-bold tracking-tight",
                  headerSubtitle: "text-[#a8a89e]",
                  socialButtonsBlockButton:
                    "bg-[#171715] border border-[rgba(255,255,255,0.14)] text-[#f4f3ef] hover:bg-[#1c1c1a]",
                  formFieldLabel: "text-[#a8a89e]",
                  footerActionLink: "text-[#2dd4bf] hover:text-[#14b8a6]",
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
