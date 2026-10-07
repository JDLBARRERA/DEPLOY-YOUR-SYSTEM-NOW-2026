import type { Metadata } from "next";
import { DesktopShell } from "@/components/desktop-shell";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "mi-paas",
  description: "Dashboard para controlar el motor PaaS.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full">
      <body
        className="min-h-full antialiased"
        style={{ fontFamily: '"Segoe UI", Tahoma, sans-serif' }}
      >
        <DesktopShell>{children}</DesktopShell>
        <Toaster />
      </body>
    </html>
  );
}
