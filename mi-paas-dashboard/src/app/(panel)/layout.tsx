import { DesktopShell } from "@/components/desktop-shell";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <DesktopShell>{children}</DesktopShell>;
}
