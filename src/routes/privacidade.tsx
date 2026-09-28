import { createFileRoute, Link } from "@tanstack/react-router";

import { BrandTitle } from "@/components/Brand";

export const Route = createFileRoute("/privacidade")({
  head: () => ({ meta: [{ title: "Privacidade — APP BARBEARIAS" }] }),
  component: PrivacidadePage,
});

function PrivacidadePage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-sm leading-relaxed text-muted-foreground">
      <BrandTitle>Privacidade</BrandTitle>

      <div className="surface mt-6 space-y-4 p-5 text-foreground">
        <p>
          O APP BARBEARIAS preza pela segurança e privacidade dos seus dados. Esta política descreve como
          coletamos, usamos e protegemos suas informações.
        </p>
        <p>
          <span className="font-semibold text-foreground">Dados coletados:</span> guardamos os dados
          estritamente necessários para o funcionamento da plataforma e dos agendamentos — nome, telefone,
          e-mail, histórico de atendimentos e dados de pagamentos de cada cliente, além dos dados cadastrais
          dos barbeiros e das barbearias parceiras.
        </p>
        <p>
          <span className="font-semibold text-foreground">Uso dos dados:</span> as informações são utilizadas
          para viabilizar os agendamentos, processar cobranças, enviar lembretes e garantir a comunicação
          direta entre o cliente e a barbearia escolhida.
        </p>
        <p>
          <span className="font-semibold text-foreground">Exclusão de conta e dados:</span> você pode excluir
          sua conta e seus dados pessoais a qualquer momento, diretamente pelo Perfil dentro do app, pela
          página <Link to="/excluir-dados" className="brand-text font-semibold">excluir meus dados</Link>, ou
          solicitando através do nosso suporte.
        </p>
        <p>
          <span className="font-semibold text-foreground">Histórico das barbearias:</span> agendamentos e
          vendas já registrados anteriormente continuam guardados de forma anônima (sem nome, telefone ou
          e-mail do cliente), pois a barbearia precisa desse histórico contábil para fins de faturamento e
          gestão fiscal.
        </p>
        <p>
          <span className="font-semibold text-foreground">Dados de pagamento:</span> todos os dados de
          transações e cartões são processados de forma segura pelo Mercado Pago. O APP BARBEARIAS não
          armazena números de cartão de crédito ou dados sensíveis de pagamento em seus servidores.
        </p>
        <p>
          <span className="font-semibold text-foreground">Identificação do controlador:</span> desenvolvido e
          administrado por Yan Ramon Rodrigues Gelsleichter (CPF: 057.667.949-67).
        </p>
        <p>
          <span className="font-semibold text-foreground">Dúvidas sobre seus dados:</span> escreva para{" "}
          <a href="mailto:appbarbeariassuporte@gmail.com" className="brand-text font-semibold">
            appbarbeariassuporte@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
