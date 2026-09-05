import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, KeyRound, Save, Upload, Image as ImageIcon, Palette, QrCode, Copy, Moon, Sun, Mail, Bell, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { QRCodeSVG } from "qrcode.react";

import { supabase } from "@/integrations/supabase/client";
import type { Barber } from "@/integrations/supabase/db-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { EmailInput } from "@/components/EmailInput";
import { Switch } from "@/components/ui/switch";
import { useDarkMode } from "@/lib/theme";
import { publicAppOrigin } from "@/lib/app-url";
import { postPublicApi } from "@/lib/api-fetch";
import { brl, fmtDate } from "@/lib/format";
import { useSubscriptionStatusQuery } from "@/hooks/use-subscription-gate";


const PRESET_COLORS = [
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
  "#ef4444", "#f59e0b", "#10b981", "#14b8a6",
  "#0ea5e9", "#eab308", "#84cc16", "#111827",
];

const emailSchema = z.string().email();

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
  const [name, setName] = useState(barber.name ?? "");
  const [businessName, setBusinessName] = useState(barber.business_name ?? "");
  const [photoUrl, setPhotoUrl] = useState(barber.logo_url ?? "");
  const [color, setColor] = useState(barber.primary_color ?? "#3b82f6");
  const [uploading, setUploading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const { dark, setDark } = useDarkMode();

  useEffect(() => {
    setName(barber.name ?? "");
    setBusinessName(barber.business_name ?? "");
    setPhotoUrl(barber.logo_url ?? "");
    setColor(barber.primary_color ?? "#3b82f6");
  }, [barber.id, barber.name, barber.business_name, barber.logo_url, barber.primary_color]);

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

  const changeEmail = useMutation({
    mutationFn: async () => {
      const value = newEmail.trim().toLowerCase();
      if (!emailSchema.safeParse(value).success) throw new Error("Informe um e-mail válido");
      if (email && value === email.toLowerCase())
        throw new Error("Este já é o seu e-mail atual");
      const { error } = await supabase.auth.updateUser(
        { email: value },
        { emailRedirectTo: `${publicAppOrigin()}/painel?tab=perfil` },
      );
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists"))
          throw new Error("Este e-mail já está em uso por outra conta");
        if (msg.includes("rate") || msg.includes("limit"))
          throw new Error("Muitas tentativas. Aguarde alguns minutos e tente novamente");
        if (msg.includes("invalid"))
          throw new Error("E-mail inválido. Verifique e tente novamente");
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Confirmação enviada", {
        description:
          "Abra o link enviado para o novo e-mail (e para o atual, se solicitado) para concluir a alteração.",
      });
      setNewEmail("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveAppearance = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("O nome não pode ficar vazio");
      const { error } = await supabase
        .from("barbers")
        .update({
          name: trimmedName,
          business_name: businessName.trim() || null,
          logo_url: photoUrl.trim() || null,
          primary_color: color || null,
        })
        .eq("id", barber.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perfil salvo");
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

        <div className="space-y-1">
          <Label htmlFor="name">Nome</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Seu nome"
          />
        </div>

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

        <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 p-3">
          <div className="flex items-center gap-3">
            {dark ? (
              <Moon className="text-muted-foreground" size={18} />
            ) : (
              <Sun className="text-muted-foreground" size={18} />
            )}
            <div>
              <p className="text-sm font-medium">Tema escuro</p>
              <p className="text-xs text-muted-foreground">{dark ? "Ativado" : "Desativado"}</p>
            </div>
          </div>
          <Switch checked={dark} onCheckedChange={setDark} aria-label="Alternar tema escuro" />
        </div>

        <Button
          variant="hero"
          onClick={() => saveAppearance.mutate()}
          disabled={saveAppearance.isPending || uploading}
        >
          {saveAppearance.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
        </Button>
      </section>

      <NotificationsSection barberId={barber.id} />

      {barber.barbershop_id ? (
        <QrInviteSection barbershopId={barber.barbershop_id} />
      ) : null}

      {barber.is_admin && barber.barbershop_id ? (
        <AssinaturaPlataformaSection barbershopId={barber.barbershop_id} />
      ) : null}



      <section className="surface space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Mail className="text-muted-foreground" size={18} />
          <h2 className="font-semibold">Alterar e-mail</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          E-mail atual: <span className="font-medium text-foreground">{email ?? "—"}</span>
        </p>
        <div className="space-y-2">
          <Label htmlFor="newemail">Novo e-mail</Label>
          <EmailInput id="newemail" value={newEmail} onChange={setNewEmail} />
        </div>
        <Button
          variant="hero"
          onClick={() => changeEmail.mutate()}
          disabled={changeEmail.isPending || !newEmail.trim()}
        >
          {changeEmail.isPending ? <Loader2 className="animate-spin" /> : <Save />} Atualizar e-mail
        </Button>
        <p className="text-xs text-muted-foreground">
          Por segurança, enviaremos um link de confirmação. A alteração só é concluída após você
          confirmar pelo e-mail recebido.
        </p>
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

function NotificationsSection({ barberId }: { barberId: string }) {
  const [enabling, setEnabling] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(`push_enabled_${barberId}`) === "1");
    } catch {
      /* ignora */
    }
  }, [barberId]);

  async function activate() {
    setEnabling(true);
    try {
      const { requestPushToken } = await import("@/lib/push-client");
      const token = await requestPushToken();
      if (!token) {
        toast.error("Não foi possível ativar. Verifique a permissão de notificações do navegador.");
        return;
      }
      const { error } = await supabase.from("push_subscriptions").insert({ barber_id: barberId, token });
      if (error && error.code !== "23505") throw error; // 23505 = esse token já estava cadastrado
      setEnabled(true);
      try {
        localStorage.setItem(`push_enabled_${barberId}`, "1");
      } catch {
        /* ignora */
      }
      toast.success("Notificações ativadas!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ativar as notificações");
    } finally {
      setEnabling(false);
    }
  }

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Bell className="text-muted-foreground" size={18} />
        <h2 className="font-semibold">Notificações</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Receba um aviso neste aparelho quando um cliente agendar um horário novo, e um lembrete 30
        minutos antes de cada atendimento.
      </p>
      <Button
        type="button"
        variant={enabled ? "outline" : "hero"}
        onClick={activate}
        disabled={enabling || enabled}
      >
        {enabling ? <Loader2 className="animate-spin" /> : <Bell />}
        {enabled ? "Notificações ativadas" : "Ativar notificações"}
      </Button>
    </section>
  );
}

function QrInviteSection({ barbershopId }: { barbershopId: string }) {
  // O slug é gerado sob demanda na primeira vez que essa tela abre (cobre
  // tanto barbearias novas quanto as que já existiam antes dessa mudança).
  const slugQ = useQuery({
    queryKey: ["barbershop-slug", barbershopId],
    queryFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const result = await postPublicApi<{ slug?: string; error?: string }>(
        "/api/public/ensure-barbershop-slug",
        { barbershop_id: barbershopId },
        session?.access_token,
      ).catch(() => null);
      return result?.slug ?? null;
    },
  });

  const inviteUrl = useMemo(() => {
    const origin = publicAppOrigin();
    // Enquanto o slug ainda não carregou (ou se algo falhar), cai no
    // formato antigo — nunca mostra um link quebrado.
    if (slugQ.data) return `${origin}/b/${slugQ.data}`;
    return `${origin}/auth?barbershop_id=${encodeURIComponent(barbershopId)}`;
  }, [slugQ.data, barbershopId]);


  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  function download() {
    const svg = document.getElementById("shop-invite-qr");
    if (!svg) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qr-barbearia.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="surface space-y-4 p-4">
      <div className="flex items-center gap-2">
        <QrCode className="text-muted-foreground" size={18} />
        <h2 className="font-semibold">QR Code da barbearia</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Compartilhe este QR Code ou link. Quem se cadastrar por ele será vinculado
        automaticamente à sua barbearia.
      </p>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="rounded-2xl bg-white p-3">
          <QRCodeSVG id="shop-invite-qr" value={inviteUrl} size={168} includeMargin={false} />
        </div>
        <div className="flex-1 space-y-2">
          <Label>Link de cadastro</Label>
          <Input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={copy}>
              <Copy /> Copiar link
            </Button>
            <Button type="button" variant="outline" onClick={download}>
              <Upload className="rotate-180" /> Baixar QR
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trial: "Teste grátis",
  active: "Ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
};

const PLATFORM_PLAN_LABEL: Record<string, string> = {
  monthly: "Mensal (R$ 49,00/mês)",
  yearly: "Anual (R$ 39,00/mês)",
};

function AssinaturaPlataformaSection({ barbershopId }: { barbershopId: string }) {
  const qc = useQueryClient();
  const statusQ = useSubscriptionStatusQuery(barbershopId);
  const [confirmingUpgrade, setConfirmingUpgrade] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const invalidateStatus = () => qc.invalidateQueries({ queryKey: ["subscription-status", barbershopId] });

  const upgrade = useMutation({
    mutationFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const result = await postPublicApi<{
        ok?: boolean;
        already_scheduled?: boolean;
        error?: string;
      }>("/api/public/platform-subscription-upgrade", {}, session?.access_token);
      if (!result?.ok) throw new Error(result?.error ?? "Não foi possível agendar o upgrade.");
      return result;
    },
    onSuccess: () => {
      toast.success("Upgrade para o anual agendado!");
      setConfirmingUpgrade(false);
      invalidateStatus();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelSubscription = useMutation({
    mutationFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const result = await postPublicApi<{ ok?: boolean; error?: string }>(
        "/api/public/platform-subscription-cancel",
        {},
        session?.access_token,
      );
      if (!result?.ok) throw new Error(result?.error ?? "Não foi possível cancelar a assinatura.");
      return result;
    },
    onSuccess: () => {
      toast.success("Assinatura cancelada.");
      setConfirmingCancel(false);
      invalidateStatus();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reactivate = useMutation({
    mutationFn: async () => {
      const session = (await supabase.auth.getSession()).data.session;
      const result = await postPublicApi<{ init_point?: string; error?: string }>(
        "/api/public/platform-subscription-reactivate",
        {},
        session?.access_token,
      );
      if (!result?.init_point) throw new Error(result?.error ?? "Não foi possível reativar a assinatura.");
      return result.init_point;
    },
    onSuccess: (initPoint) => {
      window.location.href = initPoint;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = statusQ.data;

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-center gap-2">
        <CreditCard className="text-muted-foreground" size={18} />
        <h2 className="font-semibold">Assinatura da plataforma</h2>
      </div>

      {statusQ.isLoading || !data ? (
        <Loader2 className="animate-spin text-muted-foreground" size={18} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Status:{" "}
            <span className="font-medium text-foreground">
              {SUBSCRIPTION_STATUS_LABEL[data.subscription_status ?? "trial"] ?? data.subscription_status}
            </span>
          </p>
          {data.subscription_plan && (
            <p className="text-sm text-muted-foreground">
              Plano:{" "}
              <span className="font-medium text-foreground">
                {PLATFORM_PLAN_LABEL[data.subscription_plan] ?? data.subscription_plan}
              </span>
            </p>
          )}
          {data.current_period_ends_at && (
            <p className="text-sm text-muted-foreground">
              {data.subscription_status === "active" ? "Renova em" : "Válido até"}:{" "}
              <span className="font-medium text-foreground">{fmtDate(data.current_period_ends_at)}</span>
            </p>
          )}

          {data.subscription_status === "active" && data.cancel_at_period_end ? (
            <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
              <p className="text-xs text-muted-foreground">
                Assinatura cancelada — acesso garantido até{" "}
                {data.current_period_ends_at ? fmtDate(data.current_period_ends_at) : "o fim do período atual"}
                . Depois disso o painel fica bloqueado até uma nova assinatura.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => reactivate.mutate()}
                disabled={reactivate.isPending}
              >
                {reactivate.isPending ? <Loader2 className="animate-spin" /> : "Desfazer cancelamento"}
              </Button>
            </div>
          ) : (
            <>
              {data.pending_plan_change === "yearly" ? (
                <p className="rounded-xl border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                  Upgrade para o plano anual ({brl(39)}/mês) agendado para{" "}
                  {data.current_period_ends_at ? fmtDate(data.current_period_ends_at) : "o fim do período atual"}
                  . Nenhuma cobrança extra acontece até lá.
                </p>
              ) : data.subscription_plan === "monthly" && data.subscription_status === "active" ? (
                confirmingUpgrade ? (
                  <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
                    <p className="text-xs text-muted-foreground">
                      Seu plano atual continua até{" "}
                      {data.current_period_ends_at ? fmtDate(data.current_period_ends_at) : "o fim do período atual"}
                      . Depois disso você passa a pagar {brl(39)}/mês automaticamente.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="hero"
                        onClick={() => upgrade.mutate()}
                        disabled={upgrade.isPending}
                      >
                        {upgrade.isPending ? <Loader2 className="animate-spin" /> : "Confirmar upgrade"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmingUpgrade(false)}
                        disabled={upgrade.isPending}
                      >
                        Voltar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setConfirmingUpgrade(true)}>
                    Fazer upgrade para o Anual
                  </Button>
                )
              ) : null}

              {data.subscription_status === "active" &&
                (confirmingCancel ? (
                  <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                    <p className="text-xs text-muted-foreground">
                      Sua assinatura será cancelada, mas você continua com acesso normal até{" "}
                      {data.current_period_ends_at ? fmtDate(data.current_period_ends_at) : "o fim do período atual"}
                      . Depois disso, o painel ficará bloqueado até uma nova assinatura.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => cancelSubscription.mutate()}
                        disabled={cancelSubscription.isPending}
                      >
                        {cancelSubscription.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          "Confirmar cancelamento"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmingCancel(false)}
                        disabled={cancelSubscription.isPending}
                      >
                        Voltar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2"
                    onClick={() => setConfirmingCancel(true)}
                  >
                    Cancelar assinatura
                  </button>
                ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
