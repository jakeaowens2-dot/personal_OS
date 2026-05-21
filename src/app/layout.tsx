import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Productivity OS",
  description: "A personal productivity operating system for work blocks and rewards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
