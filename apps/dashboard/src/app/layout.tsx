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
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        <header className="border-b border-neutral-200 bg-white">
          <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight">
              TwinStore
            </Link>
            <nav className="flex gap-4 text-sm text-neutral-600">
              <Link href="/swarm" className="hover:text-neutral-900">Swarm</Link>
              <Link href="/presets" className="hover:text-neutral-900">Presets</Link>
            </nav>
            <div className="flex-1" />
            <span className="text-xs text-neutral-400 font-mono">merchant dashboard</span>
          </div>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
