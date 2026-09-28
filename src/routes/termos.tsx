import { createFileRoute } from "@tanstack/react-router";

import { BrandTitle } from "@/components/Brand";

export const Route = createFileRoute("/termos")({
  head: () => ({ meta: [{ title: "Termos de uso — APP BARBEARIAS" }] }),
  component: TermosPage,
});

/**
 * Texto simples, ainda placeholder — precisa ser revisado por vocês (ou um
 * advogado) antes de valer como termos de uso de verdade. Serve pra cumprir
 * a exigência de ter um link público.
 */
function TermosPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-sm leading-relaxed text-muted-foreground">
      <BrandTitle>Termos de uso</BrandTitle>
      <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">
        Texto de exemplo — revise antes de publicar de verdade.
      </p>

      <div className="surface mt-6 space-y-4 p-5 text-foreground">
        <p>
          O APP BARBEARIAS é uma plataforma de agendamento para barbearias. Ao criar uma conta, você concorda
          em usar o app de forma correta, informando dados verdadeiros e respeitando os horários agendados.
        </p>
        <p>
          Cada barbearia é responsável pelos próprios serviços, preços e atendimento. A plataforma cuida do
          agendamento, do pagamento (via Mercado Pago) e da comunicação entre cliente e barbearia.
        </p>
        <p>
          Assinaturas de plataforma e de planos de clientes podem ser canceladas a qualquer momento, pelo
          Perfil dentro do app.
        </p>
        <p>
          Dúvidas: escreva para{" "}
          <a href="mailto:appbarbeariassuporte@gmail.com" className="brand-text font-semibold">
            appbarbeariassuporte@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
