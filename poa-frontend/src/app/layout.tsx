import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "./nav-links";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "GlimpSay - POA英语学习闭环",
  description: "视觉语言模型赋能POA英语实景交际闭环",
};

const navItems = [
  { href: "/", label: "首页" },
  { href: "/scenario", label: "场景驱动" },
  { href: "/task", label: "任务" },
  { href: "/attempt1", label: "初次产出" },
  { href: "/facilitate", label: "促成学习" },
  { href: "/attempt2", label: "二次产出" },
  { href: "/evaluate", label: "评价" },
  { href: "/report", label: "报告" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background text-foreground">
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
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          <Providers>{children}</Providers>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-6 text-center text-sm text-muted-foreground">
            GlimpSay POA英语学习闭环Demo &copy; 2025
          </div>
        </footer>
      </body>
    </html>
  );
}
