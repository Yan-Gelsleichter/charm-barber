import * as React from "react";
import { Input } from "@/components/ui/input";
import { maskPhoneBR } from "@/lib/format";

type Props = Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> & {
  value: string;
  onChange: (masked: string) => void;
};

export function PhoneInput({ value, onChange, ...rest }: Props) {
  return (
    <Input
      inputMode="tel"
      placeholder="(11) 99999-9999"
      {...rest}
      value={maskPhoneBR(value)}
      onChange={(e) => onChange(maskPhoneBR(e.target.value))}
    />
  );
}
