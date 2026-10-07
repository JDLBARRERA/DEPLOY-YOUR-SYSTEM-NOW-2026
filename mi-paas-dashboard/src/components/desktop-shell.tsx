"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FolderOpen, HardDrive, Monitor, Settings } from "lucide-react";
import { DnOrb } from "@/components/dn-orb";

const icons = [
  { href: "/", label: "Overview", icon: Monitor },
  { href: "/deployments", label: "Deployments", icon: FolderOpen },
  { href: "/databases", label: "Databases", icon: HardDrive },
  { href: "/settings", label: "Settings", icon: Settings },
];

const titles: Record<string, string> = {
  "/": "Overview",
  "/deployments": "Deployments",
  "/databases": "Databases",
  "/settings": "Settings",
};

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [startOpen, setStartOpen] = useState(false);
  const title = titles[pathname] ?? "deplowe-now.com";

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#041428] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,#b8ffd9_0%,transparent_42%),radial-gradient(ellipse_at_70%_20%,#3ee0ff_0%,transparent_36%),radial-gradient(ellipse_at_40%_80%,#1a5cff_0%,transparent_45%),radial-gradient(ellipse_at_90%_90%,#06204a_0%,#020814_70%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,transparent_0%,rgba(0,40,80,0.25)_45%,rgba(0,0,0,0.35)_100%)]" />

      <nav className="absolute top-4 left-3 z-20 flex w-[6.5rem] flex-col items-center gap-4">
        <Link
          href="/"
          aria-label="deplowe-now.com"
          className="group flex flex-col items-center gap-1.5 rounded-md px-1 py-1 text-center text-[10px] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
        >
          <DnOrb size="md" interactive className="size-[3.35rem] text-base" />
          <span className="leading-tight font-semibold break-words [overflow-wrap:anywhere]">
            deplowe-now.com
          </span>
        </Link>

        {icons.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 rounded-md px-1 py-2 text-center text-xs text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] ${
                active ? "bg-white/25 ring-1 ring-white/50" : "hover:bg-white/15"
              }`}
            >
              <span className="flex size-12 items-center justify-center rounded-lg bg-gradient-to-b from-white/50 to-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ring-1 ring-white/40">
                <Icon className="size-7 text-sky-950" />
              </span>
              <span className="leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="relative z-10 flex min-h-svh justify-center px-4 pt-6 pb-20 pl-28">
        {children}
      </div>

      {startOpen ? (
        <button
          type="button"
          aria-label="Cerrar inicio"
          className="fixed inset-0 z-30"
          onClick={() => setStartOpen(false)}
        />
      ) : null}

      {startOpen ? (
        <div className="fixed bottom-16 left-3 z-40 w-72 overflow-hidden rounded-xl border border-white/40 bg-black/30 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3 bg-gradient-to-r from-white/30 to-transparent px-4 py-3 text-sm font-semibold">
            <DnOrb size="sm" />
            deplowe-now.com
          </div>
          <div className="flex flex-col p-2">
            {icons.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setStartOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/20"
                >
                  <Icon className="size-5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      <footer className="fixed right-0 bottom-0 left-0 z-40 flex h-14 items-center gap-3 border-t border-white/30 bg-black/40 px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-xl">
        <button
          type="button"
          aria-label="Inicio deplowe-now.com"
          onClick={() => setStartOpen((open) => !open)}
          className="relative -mt-4 shrink-0 rounded-full transition-transform duration-200 hover:scale-105 active:scale-95"
        >
          <DnOrb size="lg" interactive className="size-14 text-[15px]" />
        </button>
        <Link
          href={pathname}
          className="rounded-md border border-white/40 bg-gradient-to-b from-white/35 to-white/10 px-4 py-1.5 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
        >
          {title}
        </Link>
        <button
          type="button"
          className="rounded-md border border-white/40 bg-gradient-to-b from-white/35 to-white/10 px-3 py-1.5 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] hover:from-white/50"
          onClick={() => {
            void fetch("/api/logout", { method: "POST", credentials: "include" }).then(() => {
              window.location.href = "/login";
            });
          }}
        >
          Salir
        </button>
        <div className="ml-auto pr-2">
          <Clock />
        </div>
      </footer>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    return <span className="text-xs text-white/70">--:--</span>;
  }

  return (
    <span className="block text-right text-xs leading-tight text-white">
      {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      <br />
      {now.toLocaleDateString()}
    </span>
  );
}
