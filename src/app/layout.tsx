import type { Metadata } from "next";
import { AuthRecoveryRedirect } from "@/components/auth/AuthRecoveryRedirect";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal OS",
  description: "A personal productivity operating system for work blocks and rewards.",
  applicationName: "Personal OS",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Personal OS",
  },
  icons: {
    icon: "/personal-os-icon.svg",
    apple: "/personal-os-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthRecoveryRedirect />
        {children}
      </body>
    </html>
  );
}
