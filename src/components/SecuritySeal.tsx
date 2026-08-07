import { Lock, ShieldCheck } from "lucide-react";

/**
 * Selo de site seguro — reforça a confiança no checkout com cartão.
 * Visual apenas: comunica criptografia, PCI e processamento pelo Mercado Pago.
 */
export function SecuritySeal({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <Lock className="size-3" />
        Ambiente seguro • dados criptografados • processado pelo Mercado Pago
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-success/30 bg-success/5 p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-success">Site seguro • Compra protegida</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Conexão criptografada (SSL/TLS). Seus dados de cartão são enviados diretamente ao
            Mercado Pago (padrão PCI-DSS) e nunca ficam armazenados neste site.
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {["SSL 256 bits", "PCI-DSS", "Mercado Pago", "Antifraude"].map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Lock className="size-2.5" /> {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
