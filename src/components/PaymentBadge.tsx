import { CheckCircle2, Clock, RotateCcw, XCircle, Repeat } from "lucide-react";

type Variant = {
  label: string;
  icon: typeof CheckCircle2;
  className: string;
};

const VARIANTS: Record<string, Variant> = {
  pago: {
    label: "Pago",
    icon: CheckCircle2,
    className:
      "border-[color:var(--success)]/40 bg-[color:var(--success)]/10 text-[color:var(--success)]",
  },
  pendente: {
    label: "Pagamento pendente",
    icon: Clock,
    className: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  },
  cancelado: {
    label: "Pagamento cancelado",
    icon: XCircle,
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  expirado: {
    label: "PIX expirado",
    icon: XCircle,
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  falhou: {
    label: "Pagamento recusado",
    icon: XCircle,
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  estornado: {
    label: "Estornado",
    icon: RotateCcw,
    className: "border-muted-foreground/40 bg-muted text-muted-foreground",
  },
  coberto_por_assinatura: {
    label: "Incluso na assinatura",
    icon: Repeat,
    className:
      "border-[color:var(--success)]/40 bg-[color:var(--success)]/10 text-[color:var(--success)]",
  },
};

/**
 * Selo visual do status do pagamento — atualizado automaticamente conforme o
 * webhook do Mercado Pago grava `payment_status` no agendamento.
 */
export function PaymentBadge({
  status,
  compact = false,
}: {
  status?: string | null;
  compact?: boolean;
}) {
  if (!status) return null;
  const variant = VARIANTS[status];
  if (!variant) return null;
  const Icon = variant.icon;
  const label = compact && status === "pendente" ? "Pendente" : variant.label;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${variant.className}`}
    >
      <Icon className="size-3" /> {label}
    </span>
  );
}
