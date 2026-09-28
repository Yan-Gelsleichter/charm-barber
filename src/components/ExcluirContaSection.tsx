import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { postPublicApi } from "@/lib/api-fetch";
import { fmtDate } from "@/lib/format";

interface AccountDeletionPreview {
  blocked: boolean;
  reasons: string[];
  summary: string[];
  activeSubscriptionUntil: string | null;
}

const GOOGLE_RETURN_PARAM = "confirmar_exclusao";
const CONFIRM_WORD = "EXCLUIR";

/**
 * Botão + fluxo completo de exclusão de conta (Play Store + LGPD).
 * Compartilhado entre o Perfil do barbeiro/admin, "Meus agendamentos"
 * (cliente) e a página pública `/excluir-dados`. Só aparece com sessão
 * ativa — quem não está logado não tem conta pra excluir por aqui.
 */
export function ExcluirContaSection({ redirectTo = "/auth" }: { redirectTo?: string }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(GOOGLE_RETURN_PARAM) === "1") {
      setOpen(true);
      setGoogleReady(true);
      url.searchParams.delete(GOOGLE_RETURN_PARAM);
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const previewQ = useQuery({
    queryKey: ["account-deletion-preview", session?.user.id],
    enabled: open && !!session,
    queryFn: async () => {
      const result = await postPublicApi<{ preview: AccountDeletionPreview }>(
        "/api/public/account-delete",
        { dry_run: true },
        session?.access_token,
      );
      return result?.preview ?? null;
    },
  });

  if (!session) return null;

  const isGoogle = session.user.app_metadata?.provider === "google";

  async function finish(accessToken: string) {
    setDeleting(true);
    try {
      await postPublicApi("/api/public/account-delete", {}, accessToken);
      toast.success("Sua conta foi excluída.");
      await supabase.auth.signOut();
      navigate({ to: redirectTo });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir a conta");
    } finally {
      setDeleting(false);
    }
  }

  async function confirmWithPassword() {
    if (!session?.user.email) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password,
      });
      if (error || !data.session) {
        toast.error("Senha incorreta");
        setDeleting(false);
        return;
      }
      await finish(data.session.access_token);
    } catch {
      toast.error("Senha incorreta");
      setDeleting(false);
    }
  }

  async function confirmWithGoogle() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      toast.error("Sessão não encontrada — tente de novo.");
      return;
    }
    await finish(data.session.access_token);
  }

  async function startGoogleReauth() {
    const url = new URL(window.location.href);
    url.searchParams.set(GOOGLE_RETURN_PARAM, "1");
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: url.toString() },
    });
  }

  const preview = previewQ.data;
  const canConfirm = confirmText.trim().toUpperCase() === CONFIRM_WORD && (isGoogle ? googleReady : password.length > 0);

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Trash2 className="text-destructive" size={18} />
        <h2 className="font-semibold">Excluir minha conta</h2>
      </div>
      <p className="text-xs text-muted-foreground md:text-sm">
        Apaga seus dados pessoais e encerra seu acesso. Essa ação não pode ser desfeita.
      </p>
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
        <Trash2 /> Excluir minha conta
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (deleting) return;
          setOpen(next);
          if (!next) {
            setPassword("");
            setConfirmText("");
            setGoogleReady(false);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir sua conta</DialogTitle>
            <DialogDescription>Isso apaga seus dados pessoais e não pode ser desfeito.</DialogDescription>
          </DialogHeader>

          {previewQ.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin" />
            </div>
          ) : !preview ? (
            <p className="text-sm text-destructive">Não foi possível verificar sua conta. Tente de novo.</p>
          ) : preview.blocked ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div className="space-y-1">
                  {preview.reasons.map((r, i) => (
                    <p key={i}>{r}</p>
                  ))}
                </div>
              </div>
              <Button variant="outline" onClick={() => previewQ.refetch()} disabled={previewQ.isFetching}>
                {previewQ.isFetching ? <Loader2 className="animate-spin" /> : "Verificar de novo"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                {preview.summary.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>

              {preview.activeSubscriptionUntil && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  Você ainda tem acesso até {fmtDate(preview.activeSubscriptionUntil)}. Se excluir agora, perde esse
                  período já pago.
                </p>
              )}

              {isGoogle ? (
                googleReady ? (
                  <p className="text-sm text-[color:var(--success)]">Conta confirmada pelo Google.</p>
                ) : (
                  <Button type="button" variant="outline" className="w-full" onClick={startGoogleReauth}>
                    Confirmar com Google
                  </Button>
                )
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="excluir-senha">Digite sua senha para confirmar</Label>
                  <PasswordInput
                    id="excluir-senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="excluir-confirma">
                  Digite <span className="font-semibold text-foreground">{CONFIRM_WORD}</span> para confirmar
                </Label>
                <Input
                  id="excluir-confirma"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_WORD}
                />
              </div>

              <Button
                variant="destructive"
                className="w-full"
                disabled={!canConfirm || deleting}
                onClick={isGoogle ? confirmWithGoogle : confirmWithPassword}
              >
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Excluir minha conta definitivamente
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
