import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "SF Events",
  description:
    "Music, comedy, lectures, dancing, and food across San Francisco.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <header className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-zinc-800/80 bg-zinc-950/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/60 sm:px-6">
          <Link
            href="/"
            className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-300 hover:text-zinc-100"
          >
            sf events
          </Link>
          <div data-slot="header-actions" />
        </header>
        {children}
      </body>
    </html>
  );
}
