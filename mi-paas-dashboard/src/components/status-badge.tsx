export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "failed"
      ? "from-red-200 to-red-400 text-red-950"
      : status === "running"
        ? "from-emerald-200 to-emerald-400 text-emerald-950"
        : status === "building"
          ? "from-amber-100 to-amber-300 text-amber-950"
          : "from-white to-slate-200 text-slate-800";

  return (
    <span
      className={`inline-flex rounded-full border border-white/70 bg-gradient-to-b px-2 py-0.5 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] ${tone}`}
    >
      {status}
    </span>
  );
}
