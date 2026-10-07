import Image from "next/image";
import { cn } from "@/lib/utils";

type DnOrbSize = "sm" | "md" | "lg";

const sizeClass: Record<DnOrbSize, string> = {
  sm: "size-9",
  md: "size-14",
  lg: "size-14",
};

const imageSize: Record<DnOrbSize, number> = {
  sm: 36,
  md: 56,
  lg: 56,
};

export function DnOrb({
  size = "md",
  className,
  interactive = false,
}: {
  size?: DnOrbSize;
  className?: string;
  interactive?: boolean;
}) {
  const px = imageSize[size];

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden rounded-full border border-white/40",
        "bg-black",
        "shadow-[inset_0_1px_2px_rgba(255,255,255,0.6),0_2px_8px_rgba(0,0,0,0.5),0_0_14px_rgba(56,189,248,0.45)]",
        "transition-all duration-300 ease-out",
        interactive &&
          "hover:brightness-125 hover:shadow-[inset_0_1px_2px_rgba(255,255,255,0.7),0_2px_10px_rgba(0,0,0,0.45),0_0_15px_rgba(56,189,248,0.8)]",
        sizeClass[size],
        className,
      )}
    >
      <Image
        src="/logo-deplowe-now.jpg"
        alt="deplowe-now.com"
        width={px}
        height={px}
        className="relative z-0 size-[92%] object-contain"
        priority={size !== "sm"}
      />
      {/* Reflejo superior (cristal / canica) */}
      <span className="pointer-events-none absolute top-0.5 left-[10%] z-10 h-[38%] w-[80%] rounded-b-[50%] bg-white/20 blur-[0.5px]" />
    </span>
  );
}
