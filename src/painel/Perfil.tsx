import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, KeyRound, Save, Upload, Image as ImageIcon, Palette } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import type { Barber } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";

const PRESET_COLORS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
  "#ef4444", "#f59e0b", "#10b981", "#14b8a6",
  "#0ea5e9", "#eab308", "#84cc16", "#111827",
];

const schema = z
  .object({
    password: z.string().min(6, "A nova senha deve ter ao menos 6 caracteres"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não coincidem",
    path: ["confirm"],
  });

export function PerfilTab({ barber, email }: { barber: Barber; email: string | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [businessName, setBusinessName] = useState(barber.business_name ?? "");
  const [photoUrl, setPhotoUrl] = useState(barber.logo_url ?? "");
  const [color, setColor] = useState(barber.primary_color ?? "#3b82f6");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setBusinessName(barber.business_name ?? "");
    setPhotoUrl(barber.logo_url ?? "");
    setColor(barber.primary_color ?? "#3b82f6");
  }, [barber.id, barber.business_name, barber.logo_url, barber.primary_color]);

  const change = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse({ password, confirm });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Senha atualizada");
      setPassword("");
      setConfirm("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveAppearance = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("barbers")
        .update({
          business_name: businessName.trim() || null,
          logo_url: photoUrl.trim() || null,
          primary_color: color || null,
        })
        .eq("id", barber.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Preferências salvas");
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
    setPhotoUrl(data.publicUrl);
    setUploading(false);
    toast.success("Foto enviada — clique em salvar");
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Meu perfil</h1>
        <p className="text-sm text-muted-foreground">
          Informações da sua conta e preferências.
        </p>
      </header>

      <section className="surface space-y-2 p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Nome</p>
        <p className="font-semibold">{barber.name}</p>
        <p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">E-mail</p>
        <p className="break-all text-sm">{email ?? "—"}</p>
        <p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">Perfil</p>
        <p className="text-sm">{barber.is_admin ? "Administrador" : "Barbeiro"}</p>
      </section>

      <section className="surface space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Palette className="text-muted-foreground" size={18} />
          <h2 className="font-semibold">Personalização</h2>
        </div>

        <div className="space-y-2">
          <Label>Foto</Label>
          <div className="flex items-center gap-4">
            <div
              className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-border bg-secondary"
              style={{ backgroundColor: "color-mix(in oklab, var(--brand-from) 12%, transparent)" }}
            >
              {photoUrl ? (
                <img src={photoUrl} alt="foto" className="h-full w-full object-cover" />
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
                Enviar foto
              </Button>
              <Input
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
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
          onClick={() => saveAppearance.mutate()}
          disabled={saveAppearance.isPending || uploading}
        >
          {saveAppearance.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
        </Button>
      </section>

      <section className="surface space-y-4 p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="text-muted-foreground" size={18} />
          <h2 className="font-semibold">Trocar senha</h2>
        </div>
        <div className="space-y-2">
          <Label htmlFor="newpass">Nova senha</Label>
          <PasswordInput
            id="newpass"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmpass">Confirmar nova senha</Label>
          <PasswordInput
            id="confirmpass"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button
          variant="hero"
          onClick={() => change.mutate()}
          disabled={change.isPending || !password || !confirm}
        >
          {change.isPending ? <Loader2 className="animate-spin" /> : <Save />} Atualizar senha
        </Button>
      </section>
    </div>
  );
}
