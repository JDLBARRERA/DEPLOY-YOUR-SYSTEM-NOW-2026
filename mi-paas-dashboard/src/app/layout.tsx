import type { Metadata } from "next";
import { DesktopShell } from "@/components/desktop-shell";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "deplowe-now.com | PaaS Dashboard",
  description: "Dashboard PaaS de deplowe-now.com.",
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
