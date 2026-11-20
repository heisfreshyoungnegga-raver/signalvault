import { cn } from "@/lib/utils";

/**
 * Google Material Symbols (Outlined) icon.
 * Usage: <MaterialIcon name="check_circle" className="size-4" filled />
 */
export function MaterialIcon({
  name,
  className,
  filled = false,
  style,
}: {
  name: string;
  className?: string;
  filled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={cn("material-symbols-outlined inline-flex shrink-0 items-center justify-center", className)}
      style={{ fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 500, 'GRAD' 0, 'opsz' 24`, ...style }}
    >
      {name}
    </span>
  );
}
