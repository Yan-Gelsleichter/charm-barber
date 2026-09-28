import { createFileRoute, Link } from "@tanstack/react-router";

import { BrandTitle } from "@/components/Brand";

export const Route = createFileRoute("/privacidade")({
  head: () => ({ meta: [{ title: "Privacidade — APP BARBEARIAS" }] }),
  component: PrivacidadePage,
});

/**
 * Texto simples, ainda placeholder — precisa ser revisado por vocês (ou um
 * advogado) antes de valer como política de privacidade de verdade. Serve
 * pra cumprir a exigência de ter um link público, e explicar em linhas
 * gerais o que a exclusão de conta faz.
 */
function PrivacidadePage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-sm leading-relaxed text-muted-foreground">
      <BrandTitle>Privacidade</BrandTitle>
      <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">
        Texto de exemplo — revise antes de publicar de verdade.
      </p>

      <div className="surface mt-6 space-y-4 p-5 text-foreground">
        <p>
          O APP BARBEARIAS guarda os dados necessários para o funcionamento do agendamento: nome, telefone,
          e-mail e histórico de atendimentos e pagamentos de cada cliente, e dados de cadastro de barbeiros e
          barbearias.
        </p>
        <p>
          Você pode excluir sua conta e seus dados pessoais a qualquer momento, pelo Perfil dentro do app ou
          por <Link to="/excluir-dados" className="brand-text font-semibold">esta página</Link>. Agendamentos
          e vendas já registrados continuam guardados de forma anônima (sem seu nome, telefone ou e-mail),
          pois a barbearia precisa desse histórico para o faturamento dela.
        </p>
        <p>
          Dados de pagamento são processados pelo Mercado Pago — não guardamos número de cartão nenhum.
        </p>
        <p>
          Dúvidas sobre seus dados: escreva para{" "}
          <a href="mailto:appbarbeariassuporte@gmail.com" className="brand-text font-semibold">
            appbarbeariassuporte@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
