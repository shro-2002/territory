import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const displaySerif = Instrument_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Territory — cultural research and localization planning for film",
  description: "Qloo-grounded cultural research for independent film: what Qloo associates with your comps in each candidate country, what is generic and what is distinctive, and how your localization budget and scenarios play out.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${displaySerif.variable} h-full antialiased`}>
      <body className="relative min-h-full">{children}</body>
    </html>
  );
}
