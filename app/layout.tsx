import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { DigestButton } from "./components/digest-button";
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

const SITE_URL = "https://sf-events-aggregator-two.vercel.app";
const SITE_DESCRIPTION =
  "A daily-refreshed calendar of music, comedy, lectures, dancing, and food across San Francisco. Free, no accounts.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "SF Events — Music, Comedy, Lectures, Dancing, Food",
    template: "%s · SF Events",
  },
  description: SITE_DESCRIPTION,
  applicationName: "SF Events",
  keywords: [
    "San Francisco",
    "events",
    "calendar",
    "music",
    "comedy",
    "lectures",
    "dancing",
    "food",
    "things to do in SF",
  ],
  openGraph: {
    type: "website",
    title: "SF Events — Music, Comedy, Lectures, Dancing, Food",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "SF Events",
    locale: "en_US",
    // Image auto-resolved from app/opengraph-image.tsx
  },
  twitter: {
    card: "summary_large_image",
    title: "SF Events — Music, Comedy, Lectures, Dancing, Food",
    description: SITE_DESCRIPTION,
    // Image auto-resolved from app/twitter-image.tsx or opengraph-image.tsx
  },
  robots: {
    index: true,
    follow: true,
  },
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
          <div data-slot="header-actions" className="flex items-center gap-2">
            <DigestButton />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
