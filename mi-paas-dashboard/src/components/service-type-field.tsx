"use client";

import type { ReactNode } from "react";
import { Cog, Globe } from "lucide-react";

export type ServiceType = "web" | "worker";

export function serviceTypeOf(value: string | null | undefined): ServiceType {
  return value === "worker" ? "worker" : "web";
}

export function ServiceTypeField({
  value,
  onChange,
}: {
  value: ServiceType;
  onChange: (value: ServiceType) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-xs font-medium text-slate-700">Tipo de servicio</legend>
      <div className="grid grid-cols-2 gap-2">
        <ServiceChoice
          pressed={value === "web"}
          onClick={() => onChange("web")}
          icon={<Globe className="size-3.5" aria-hidden />}
          label="Web Service"
        />
        <ServiceChoice
          pressed={value === "worker"}
          onClick={() => onChange("worker")}
          icon={<Cog className="size-3.5" aria-hidden />}
          label="Background Worker"
        />
      </div>
    </fieldset>
  );
}

function ServiceChoice({
  pressed,
  onClick,
  icon,
  label,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-semibold ${
        pressed
          ? "border-sky-900/30 bg-white text-sky-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
          : "border-white/70 bg-white/50 text-slate-600"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function ServiceTypeMark({ serviceType }: { serviceType?: string | null }) {
  const worker = serviceType === "worker";
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/70 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-600">
      {worker ? <Cog className="size-3" aria-hidden /> : <Globe className="size-3" aria-hidden />}
      {worker ? "Worker" : "Web"}
    </span>
  );
}
