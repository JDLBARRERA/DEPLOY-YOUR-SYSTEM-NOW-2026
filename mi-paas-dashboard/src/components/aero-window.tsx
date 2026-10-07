"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);

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
      className={`${frame} flex flex-col overflow-hidden rounded-xl border border-white/40 bg-white/20 shadow-2xl backdrop-blur-lg`}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 bg-gradient-to-b from-white/70 via-sky-300/80 to-sky-700/90 px-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
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
}: {
  id: string;
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      {label}
      <input
        id={id}
        name={name}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
      />
    </label>
  );
}
