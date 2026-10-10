"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";

const TASKBAR_PX = 56;
const TITLE_PX = 36;
const VISIBLE_PX = 48;

type DragPlace = { x: number; y: number; width: number };

function clampPlace(x: number, y: number, width: number): { x: number; y: number } {
  const maxX = window.innerWidth - VISIBLE_PX;
  const minX = VISIBLE_PX - width;
  const maxY = Math.max(0, window.innerHeight - TASKBAR_PX - TITLE_PX);
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(0, y)),
  };
}

export function AeroWindow({
  title,
  children,
  onClose,
  dialog = false,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  dialog?: boolean;
  wide?: boolean;
}) {
  const router = useRouter();
  const frameRef = useRef<HTMLElement>(null);
  const drag = useRef<{ dx: number; dy: number; width: number } | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [place, setPlace] = useState<DragPlace | null>(null);

  useEffect(() => {
    function onMove(event: MouseEvent) {
      const current = drag.current;
      if (!current) return;
      const next = clampPlace(event.clientX - current.dx, event.clientY - current.dy, current.width);
      setPlace({ x: next.x, y: next.y, width: current.width });
    }
    function onUp() {
      drag.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function onTitleDown(event: ReactMouseEvent<HTMLElement>) {
    if (maximized || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button")) return;
    const node = frameRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    drag.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      width: rect.width,
    };
    const next = clampPlace(rect.left, rect.top, rect.width);
    setPlace({ x: next.x, y: next.y, width: rect.width });
    event.preventDefault();
  }

  function close() {
    if (onClose) {
      onClose();
      return;
    }
    router.push("/");
  }

  const frame = maximized
    ? "fixed top-3 right-3 bottom-16 left-28 z-30"
    : dialog
      ? wide
        ? "w-full max-w-3xl"
        : "w-full max-w-md"
      : "mt-4 w-full max-w-4xl";

  return (
    <section
      ref={frameRef}
      className={`${frame} flex flex-col overflow-hidden rounded-xl border border-white/40 bg-white/20 shadow-2xl backdrop-blur-lg`}
      style={
        place && !maximized
          ? { position: "fixed", left: place.x, top: place.y, width: place.width, zIndex: 30, marginTop: 0 }
          : undefined
      }
    >
      <header
        onMouseDown={onTitleDown}
        className="flex h-9 shrink-0 items-center gap-2 bg-gradient-to-b from-white/70 via-sky-300/80 to-sky-700/90 px-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
      >
        <span className="truncate font-semibold drop-shadow">{title}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {dialog ? null : (
            <>
              <WindowButton label="Minimizar" onClick={() => setMinimized((value) => !value)}>
                <span className="mb-1 block h-0.5 w-2.5 bg-sky-950" />
              </WindowButton>
              <WindowButton label="Maximizar" onClick={() => setMaximized((value) => !value)}>
                <span className="block size-2.5 border border-sky-950" />
              </WindowButton>
            </>
          )}
          <button
            type="button"
            aria-label="Cerrar"
            onClick={close}
            className="flex size-5 items-center justify-center rounded-full border border-red-950/40 bg-gradient-to-b from-red-300 to-red-600 text-[11px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
          >
            ×
          </button>
        </span>
      </header>
      {minimized ? null : (
        <div className="m-2 overflow-auto rounded-lg border border-white/40 bg-white/70 p-4 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
          {children}
        </div>
      )}
    </section>
  );
}

function WindowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-5 items-center justify-center rounded-full border border-white/50 bg-gradient-to-b from-white to-sky-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
    >
      {children}
    </button>
  );
}

export function WinButton({
  children,
  type = "button",
  disabled,
  onClick,
  compact = false,
}: {
  children: React.ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={
        compact
          ? "inline-flex items-center gap-1 rounded-md border border-white/70 bg-gradient-to-b from-white to-sky-200 px-2 py-1 text-xs whitespace-nowrap text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(0,0,0,0.25)] hover:from-white hover:to-sky-100 disabled:opacity-60"
          : "rounded-md border border-white/70 bg-gradient-to-b from-white to-sky-200 px-3 py-1.5 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(0,0,0,0.25)] hover:from-white hover:to-sky-100 disabled:opacity-60"
      }
    >
      {children}
    </button>
  );
}

export function WinField({
  id,
  label,
  name,
  required,
  placeholder,
  defaultValue,
  type = "text",
}: {
  id: string;
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  type?: "text" | "password" | "url";
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      {label}
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
      />
    </label>
  );
}
