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
      {children ?? "APP BARBEARIAS"}
    </h1>
  );
}

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <div
      className="brand-gradient flex items-center justify-center rounded-2xl text-white font-bold"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      AB
    </div>
  );
}

/** Tela cheia de carregamento (login, painel, início do cliente): o ícone
 *  do app pulsando de tamanho e brilho, em vez do spinner genérico. */
export function BrandLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <img
        src="/icon-192.png"
        alt="App Barbearias"
        width={80}
        height={80}
        className="brand-breathe size-20 rounded-2xl"
      />
    </div>
  );
}
