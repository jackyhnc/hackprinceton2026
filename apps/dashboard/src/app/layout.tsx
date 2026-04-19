import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TwinStore",
  description: "Digital-twin swarm for Shopify personalization",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900" suppressHydrationWarning>
        <header className="border-b border-zinc-200/70 bg-white">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
            <Link href="/" className="font-medium tracking-tight text-zinc-900">
              TwinStore
            </Link>
            <nav className="flex gap-5 text-sm text-zinc-500">
              <Link href="/swarm" className="hover:text-zinc-900 transition">
                Swarm
              </Link>
              <Link href="/presets" className="hover:text-zinc-900 transition">
                Presets
              </Link>
              <Link href="/shopper" className="hover:text-zinc-900 transition">
                My profile
              </Link>
            </nav>
            <div className="flex-1" />
            <span className="text-xs text-zinc-400 font-mono">merchant dashboard</span>
          </div>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
