import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import craftsmanLogo from "./assets/CraftsmanLabs.svg";
import "./globals.css";

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap"
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
    <html lang="en" data-theme="dark">
      <body className={jetBrainsMono.className}>{children}</body>
    </html>
  );
}
