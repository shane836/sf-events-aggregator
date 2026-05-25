import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DigestButton } from "./components/digest-button";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
        {/*
         * Header skeleton. Stream F (M4) added this; Stream E (M2) will
         * fill out the surrounding chrome (filter chips, date nav) around
         * the `data-slot="header-actions"` div. The digest button lives in
         * that slot today and stays there when M2 lands.
         */}
        <header className="border-b border-zinc-800">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500">
              SF Events
            </p>
            <div
              data-slot="header-actions"
              className="flex items-center gap-2"
            >
              <DigestButton />
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
