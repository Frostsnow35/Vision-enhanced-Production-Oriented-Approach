import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "./nav-links";
import { Providers } from "./providers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import LocaleSwitcher from "@/components/LocaleSwitcher";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("layout");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  const navItems = [
    { href: "/", label: "nav.home" },
    { href: "/scenario", label: "nav.scenario" },
    { href: "/task", label: "nav.task" },
    { href: "/attempt1", label: "nav.attempt1" },
    { href: "/facilitate", label: "nav.facilitate" },
    { href: "/attempt2", label: "nav.attempt2" },
    { href: "/evaluate", label: "nav.evaluate" },
    { href: "/report", label: "nav.report" },
  ];

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <NextIntlClientProvider messages={messages}>
          <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
            <nav className="mx-auto flex max-w-6xl items-center gap-6 overflow-x-auto px-4 py-2">
              <Link href="/" className="flex items-center gap-2 shrink-0">
                <Image
                  src="/logo.png"
                  alt="POA Logo"
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-lg"
                  priority
                />
                <span className="font-bold text-lg text-primary">GlimpSay</span>
              </Link>
              <NavLinks items={navItems} />
              <div className="ml-auto">
                <LocaleSwitcher />
              </div>
            </nav>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
            <Providers>{children}</Providers>
          </main>

          <footer className="border-t border-border">
            <div className="mx-auto max-w-6xl px-4 py-6 text-center text-sm text-muted-foreground">
              POA English Learning Loop Demo &copy; 2025
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
