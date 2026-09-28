import { createFileRoute } from "@tanstack/react-router";

import { BrandTitle } from "@/components/Brand";

export const Route = createFileRoute("/termos")({
  head: () => ({ meta: [{ title: "Termos de uso — APP BARBEARIAS" }] }),
  component: TermosPage,
});

function TermosPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-sm leading-relaxed text-muted-foreground">
      <BrandTitle>Termos de uso</BrandTitle>

      <div className="surface mt-6 space-y-4 p-5 text-foreground">
        <p>
          Ao utilizar o APP BARBEARIAS, você concorda com as regras abaixo. Leia com atenção antes de começar
          a usar a plataforma.
        </p>
        <p>
          <span className="font-semibold text-foreground">Sobre a plataforma:</span> o APP BARBEARIAS é uma
          solução tecnológica de agendamento e gestão voltada para o setor de barbearias. A plataforma
          gerencia os horários, os pagamentos (via Mercado Pago) e a comunicação, mas a execução dos serviços
          de barbearia é de inteira responsabilidade de cada estabelecimento parceiro.
        </p>
        <p>
          <span className="font-semibold text-foreground">Regras de conduta:</span> ao criar uma conta, você
          se compromete a fornecer dados verdadeiros, utilizar o app de forma correta e respeitar os horários
          agendados. O uso abusivo da plataforma poderá resultar no bloqueio da conta.
        </p>
        <p>
          <span className="font-semibold text-foreground">Limitação de responsabilidade:</span> o APP
          BARBEARIAS não se responsabiliza por eventuais falhas, atrasos, insatisfações ou danos decorrentes
          dos serviços prestados fisicamente pelas barbearias. Nossa responsabilidade se restringe
          exclusivamente à disponibilidade e ao funcionamento do sistema tecnológico.
        </p>
        <p>
          <span className="font-semibold text-foreground">Assinaturas e cancelamentos:</span> as assinaturas
          de acesso à plataforma (para barbearias) e os planos de clientes podem ser cancelados a qualquer
          momento diretamente pelo menu Perfil dentro do app. O cancelamento interrompe cobranças futuras,
          mantendo o acesso ativo até o término do ciclo já pago (salvo políticas específicas de reembolso
          estipuladas no ato da contratação).
        </p>
        <p>
          <span className="font-semibold text-foreground">Propriedade intelectual:</span> todo o design,
          código, marca e identidade visual do APP BARBEARIAS são protegidos e pertencem exclusivamente aos
          criadores da plataforma, sendo proibida a sua reprodução sem autorização prévia.
        </p>
        <p>
          <span className="font-semibold text-foreground">Atualizações dos termos:</span> estes termos podem
          ser atualizados periodicamente para refletir melhorias no app. O uso continuado da plataforma após
          as alterações implica na concordância com os novos termos.
        </p>
        <p>
          <span className="font-semibold text-foreground">Dúvidas e suporte:</span> escreva para{" "}
          <a href="mailto:appbarbeariassuporte@gmail.com" className="brand-text font-semibold">
            appbarbeariassuporte@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
