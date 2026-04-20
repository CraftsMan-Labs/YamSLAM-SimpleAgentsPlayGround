import type { Metadata } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import type { ReactNode } from "react";
import craftsmanLogo from "./assets/CraftsmanLabs.svg";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
  weight: ["400", "500", "700", "900"]
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono"
});

export const metadata: Metadata = {
  title: "SimpleAgents - YamSLAM",
  description: "SimpleAgents playground for YAML-first AgentFactory",
  icons: {
    icon: craftsmanLogo.src,
    shortcut: craftsmanLogo.src,
    apple: craftsmanLogo.src
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" className={`${outfit.variable} ${jetBrainsMono.variable}`}>
      <body className={outfit.className}>{children}</body>
    </html>
  );
}
