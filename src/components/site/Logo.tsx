import { cn } from "@/lib/utils";

/**
 * SignalVault brand mark — the weave: a rounded square in cream with a
 * woven mark. Three vertical warp bars (terracotta, indigo, teal) crossed
 * by three horizontal weft bars (cream, terracotta, indigo) with a 1px
 * sand gap at each crossing, so the mark reads as cloth, not as a badge.
 * No hexagon, no strongbox, no pulse line, no glowing node.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#FBF6EC" stroke="#E8DFCE" strokeWidth="1.5" />
      {/* warp bars — vertical */}
      <rect x="10" y="8" width="6" height="32" rx="1.5" fill="#E14D2A" />
      <rect x="21" y="8" width="6" height="32" rx="1.5" fill="#2E3A8C" />
      <rect x="32" y="8" width="6" height="32" rx="1.5" fill="#0F766E" />
      {/* weft bars — horizontal, with sand gaps at the crossings */}
      <rect x="6" y="12" width="36" height="5" rx="1.5" fill="#FBF6EC" stroke="#E8DFCE" strokeWidth="1" />
      <rect x="6" y="21.5" width="36" height="5" rx="1.5" fill="#E14D2A" />
      <rect x="6" y="31" width="36" height="5" rx="1.5" fill="#2E3A8C" />
    </svg>
  );
}

/** 3-bar kente mini strip (terracotta / indigo / teal), desktop sizes only. */
export function KenteStripMini({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("hidden h-[6px] w-[18px] overflow-hidden rounded-full sm:inline-block", className)}
    >
      <span className="flex h-full w-full">
        <span className="h-full w-1/3 bg-[#E14D2A]" />
        <span className="h-full w-1/3 bg-[#2E3A8C]" />
        <span className="h-full w-1/3 bg-[#0F766E]" />
      </span>
    </span>
  );
}

export function Logo({
  compact = false,
  className,
  markClassName = "size-9",
}: {
  compact?: boolean;
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} />
      <span className="font-logo text-[17px] leading-none font-black tracking-[-0.02em] text-foreground sm:text-lg">
        Signal{" "}
        <span className="font-sans text-[15px] font-bold tracking-normal text-primary sm:text-base">
          Vault
        </span>
      </span>
      {!compact && <KenteStripMini />}
    </span>
  );
}
