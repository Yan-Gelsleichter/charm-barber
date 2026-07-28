import { cn } from "@/lib/utils";

export function BrandTitle({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <h1
      className={cn(
        "brand-text text-4xl font-bold tracking-tight sm:text-5xl",
        className,
      )}
    >
      {children ?? "VIP BARBER"}
    </h1>
  );
}

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <div
      className="brand-gradient flex items-center justify-center rounded-2xl text-white font-bold"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      VB
    </div>
  );
}
