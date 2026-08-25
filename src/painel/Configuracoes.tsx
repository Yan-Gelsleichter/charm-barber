import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Upload, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/typed-client";
import type { Barber } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRESET_COLORS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
  "#ef4444", "#f59e0b", "#10b981", "#14b8a6",
  "#0ea5e9", "#eab308", "#84cc16", "#111827",
];

export function ConfiguracoesTab({ barber }: { barber: Barber }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [businessName, setBusinessName] = useState(barber.business_name ?? "");
  const [logoUrl, setLogoUrl] = useState(barber.logo_url ?? "");
  const [color, setColor] = useState(barber.primary_color ?? "#3b82f6");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setBusinessName(barber.business_name ?? "");
    setLogoUrl(barber.logo_url ?? "");
    setColor(barber.primary_color ?? "#3b82f6");
  }, [barber.id, barber.business_name, barber.logo_url, barber.primary_color]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("barbers")
        .update({
          business_name: businessName.trim() || null,
          logo_url: logoUrl.trim() || null,
          primary_color: color || null,
        })
        .eq("id", barber.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configurações salvas");
      qc.invalidateQueries({ queryKey: ["me-barber"] });
      qc.invalidateQueries({ queryKey: ["barbers-list"] });
      qc.invalidateQueries({ queryKey: ["shop-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function onUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Envie um arquivo de imagem");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Máximo 3MB");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop() || "png";
    const path = `${barber.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("barberlogos")
      .upload(path, file, { cacheControl: "3600", upsert: true });
    if (error) {
      setUploading(false);
      toast.error("Falha no upload", { description: error.message });
      return;
    }
    const { data } = supabase.storage.from("barberlogos").getPublicUrl(path);
    setLogoUrl(data.publicUrl);
    setUploading(false);
    toast.success("Logo enviada — clique em salvar");
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Configurações da barbearia</h1>
        <p className="text-sm text-muted-foreground">
          Personalize nome, logo e cor do seu app.
        </p>
      </header>

      <section className="surface space-y-4 p-4">
        <div className="space-y-1">
          <Label htmlFor="bname">Nome da barbearia</Label>
          <Input
            id="bname"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Ex.: VIP Barber Studio"
          />
        </div>

        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-4">
            <div
              className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-border bg-secondary"
              style={{ backgroundColor: "color-mix(in oklab, var(--brand-from) 12%, transparent)" }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="logo" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                Enviar logo
              </Button>
              <Input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="ou cole uma URL de imagem"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Cor primária</Label>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                className="h-9 w-9 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  borderColor: color.toLowerCase() === c ? "white" : "transparent",
                  boxShadow: color.toLowerCase() === c ? "0 0 0 2px var(--brand-from)" : "none",
                }}
              />
            ))}
            <label className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-sm">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-6 w-8 cursor-pointer rounded border-none bg-transparent p-0"
              />
              <span className="font-mono text-xs">{color}</span>
            </label>
          </div>
          <div
            className="mt-3 rounded-xl p-4 text-center text-sm font-semibold text-white"
            style={{ background: color }}
          >
            Prévia do tema
          </div>
        </div>

        <Button
          variant="hero"
          onClick={() => save.mutate()}
          disabled={save.isPending || uploading}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
        </Button>
      </section>
    </div>
  );
}
