import type { Metadata } from "next";
import { DesktopShell } from "@/components/desktop-shell";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "deplowe-now.com | Control Plane",
  description: "Control plane PaaS de deplowe-now.com.",
  icons: {
    icon: [{ url: "/logo-deplowe-now.jpg", type: "image/jpeg" }],
    apple: [{ url: "/logo-deplowe-now.jpg", type: "image/jpeg" }],
  },
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
