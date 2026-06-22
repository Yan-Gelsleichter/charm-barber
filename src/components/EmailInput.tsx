import * as React from "react";
import { Input } from "@/components/ui/input";
import { EMAIL_SUGGESTIONS } from "@/lib/format";

type Props = Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> & {
  value: string;
  onChange: (v: string) => void;
};

export function EmailInput({ value, onChange, ...rest }: Props) {
  const hasAt = value.includes("@");
  const showSuggestions = value.length > 0 && !hasAt;
  return (
    <div className="space-y-2">
      <Input
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="seu@email.com"
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\s/g, "").toLowerCase())}
      />
      {showSuggestions && (
        <div className="flex flex-wrap gap-2">
          {EMAIL_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(value + s)}
              className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:brand-gradient-soft hover:text-foreground"
            >
              {value}
              <span className="brand-text font-semibold">{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
