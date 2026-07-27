import * as React from "react";
import { Input } from "@/components/ui/input";
import { EMAIL_SUGGESTIONS } from "@/lib/format";

type Props = Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> & {
  value: string;
  onChange: (v: string) => void;
};

export function EmailInput({ value, onChange, ...rest }: Props) {
  const atIndex = value.indexOf("@");
  const local = atIndex === -1 ? value : value.slice(0, atIndex);
  const domainTyped = atIndex === -1 ? "" : value.slice(atIndex); // inclui "@"
  const suggestions = EMAIL_SUGGESTIONS.filter((s) =>
    domainTyped ? s.startsWith(domainTyped) && s !== domainTyped : true,
  );
  const showSuggestions = local.length > 0 && suggestions.length > 0;
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
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(local + s)}
              className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:brand-gradient-soft hover:text-foreground"
            >
              {local}
              <span className="brand-text font-semibold">{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
