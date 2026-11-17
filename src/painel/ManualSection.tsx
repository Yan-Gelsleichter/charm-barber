import { useState } from "react";
import { BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function H1({ children, first }: { children: string; first?: boolean }) {
  return (
    <h3 className={`text-base font-bold text-foreground ${first ? "" : "mt-6"}`}>{children}</h3>
  );
}
function H2({ children }: { children: string }) {
  return <h4 className="mt-4 text-sm font-semibold text-foreground">{children}</h4>;
}
function H3({ children }: { children: string }) {
  return <h5 className="mt-3 text-sm font-semibold text-muted-foreground">{children}</h5>;
}
function P({ children }: { children: string }) {
  return <p className="mt-2 text-sm text-muted-foreground">{children}</p>;
}
function PBold({ children }: { children: string }) {
  return <p className="mt-2 text-sm font-semibold text-foreground">{children}</p>;
}
function Steps({ items }: { items: string[] }) {
  return (
    <div className="mt-2 space-y-1.5">
      {items.map((text, i) => (
        <p key={i} className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{i + 1}. </span>
          {text}
        </p>
      ))}
    </div>
  );
}
function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      {items.map((text, i) => (
        <li key={i}>{text}</li>
      ))}
    </ul>
  );
}
function Note({ children }: { children: string }) {
  return <p className="mt-2 text-xs italic text-muted-foreground">Observação: {children}</p>;
}
function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="mt-3">
      <p className="text-sm font-semibold text-foreground">{q}</p>
      <p className="mt-1 text-sm text-muted-foreground">{a}</p>
    </div>
  );
}

function ManualBody() {
  return (
    <div>
      <P>
        Este manual explica, em linguagem simples, como usar o App Barbearias — tanto do lado do
        administrador da barbearia quanto do lado do cliente que agenda os horários.
      </P>

      <H1 first>1. Primeiro acesso — criando sua barbearia no app</H1>

      <H2>1.1 Criando sua conta e começando o teste grátis de 7 dias</H2>
      <P>Todo dono de barbearia começa com 7 dias de teste grátis, sem precisar de cartão de crédito.</P>
      <Steps
        items={[
          'Na tela de login, toque em "É dono de barbearia? Comece seu teste grátis de 7 dias".',
          'Vai aparecer uma janela "Teste grátis por 7 dias", explicando que não há cobrança nesse período — a assinatura só começa a valer depois dos 7 dias, se você continuar.',
          'Escolha uma das opções: "Continuar com teste grátis" (começa a usar e decide depois) ou "Assinar agora" (já escolhe um plano pago de uma vez).',
          "Preencha o formulário: Seu nome, Nome da barbearia, WhatsApp (opcional), E-mail e Senha.",
          'Toque em "Começar meu teste grátis".',
        ]}
      />
      <P>
        Pronto — sua barbearia é criada na hora e você já cai no painel. Sua conta já nasce como
        administrador (admin) dessa barbearia.
      </P>
      <P>
        Logo nesse primeiro acesso aparece um aviso no topo do painel, convidando você a dar uma
        olhada no manual do app (que fica na aba Perfil). Esse aviso some ao tocar no X e não
        aparece mais depois.
      </P>
      <PBold>Avisos de que o teste grátis está acabando</PBold>
      <P>
        Faltando 2 dias para o fim do teste grátis, aparece um aviso no topo do painel: "Faltam 2
        dias para o fim do seu teste grátis." Você pode fechar esse aviso tocando no X. No dia
        seguinte, falta só 1 dia, e aparece um novo aviso — fechar o de "faltam 2 dias" não
        esconde o de "falta 1 dia"; são dois avisos separados, um por dia.
      </P>

      <H2>1.2 Conectando sua conta do Mercado Pago</H2>
      <P>
        Esse passo é o que permite seus clientes pagarem online (Pix ou cartão) e, se você quiser,
        também permite cobrar a assinatura da plataforma e os planos de clientes.
      </P>
      <Steps
        items={[
          'No painel, abra a aba "Pagamentos".',
          'Escolha o modelo de repasse: "Conta única (padrão)" (todo o dinheiro cai direto na sua conta) ou "Split por subcontas" (cada barbeiro recebe a própria parte direto). Essa escolha é salva assim que você toca nela.',
          'Role até a seção "Mercado Pago da barbearia". Se ainda não tiver conta no Mercado Pago, você pode criar uma pelo próprio app do Mercado Pago ou pelo Mercado Livre.',
          'Toque em "Conectar com Mercado Pago".',
          "Você será levado para o site do Mercado Pago para fazer login e autorizar a conexão.",
          'Depois de autorizar, você volta para o painel e aparece o aviso "Mercado Pago conectado!".',
          'Se quiser, ative ou desative o botão "Permitir pagamento presencial" — com ele ativado, o cliente também pode escolher pagar na hora, na barbearia, em vez de pagar online.',
        ]}
      />
      <P>
        Se você escolheu "Split por subcontas" no passo 2, ainda aparece a seção "Comissões por
        profissional", onde você define a porcentagem que cada barbeiro recebe.
      </P>

      <H2>1.3 Adicionando os barbeiros da sua equipe</H2>
      <P>Diferente de um convite por link, você mesmo cria o login de cada barbeiro da equipe.</P>
      <Steps
        items={[
          'No painel, abra a aba "Barbeiros".',
          'Na seção "Cadastrar novo barbeiro", preencha: Nome, E-mail (login) e Senha temporária (pelo menos 6 caracteres).',
          'Marque "Conceder privilégios de admin" somente se quiser que essa pessoa também administre a barbearia (veja outras abas, configure planos, etc.).',
          'Toque em "Cadastrar".',
        ]}
      />
      <P>
        O barbeiro já pode entrar no app com o e-mail e a senha que você definiu. Avise ele
        pessoalmente dessas informações — o app não envia nenhum e-mail automático com a senha.
      </P>
      <P>
        Nessa mesma aba, cada barbeiro já cadastrado tem um botão para "Tornar admin" / "Revogar
        admin" e um botão "Excluir" (com confirmação) para removê-lo da equipe.
      </P>

      <H2>1.4 Compartilhando o QR Code e o link da barbearia com os clientes</H2>
      <P>Esse é o jeito dos seus clientes chegarem até a sua barbearia dentro do app.</P>
      <Steps
        items={[
          'No painel, abra a aba "Perfil".',
          'Role até a seção "QR Code da barbearia".',
          "Você verá o QR Code e, logo abaixo, o link da sua barbearia (algo como appbarbearias.com.br/b/nome-da-sua-barbearia).",
          'Toque em "Copiar link" para colar em uma mensagem, em "Baixar QR" para salvar a imagem, ou em "Compartilhar" para enviar direto pelo WhatsApp ou outro app.',
        ]}
      />
      <P>Quem se cadastrar por esse link ou QR Code já é automaticamente vinculado à sua barbearia.</P>

      <H1>2. Conhecendo o painel — aba por aba</H1>
      <P>
        As abas aparecem nessa mesma ordem, tanto no computador (barra lateral) quanto no celular
        (barra inferior ou tela "Início").
      </P>

      <H2>2.1 Caixa</H2>
      <P>
        É o controle financeiro (da barbearia inteira, contando todos os agendamentos de todos os
        barbeiros) no dia a dia: mostra os totais de Hoje, Esta semana, Este mês e Este ano, além
        da lista de atendimentos do dia com botões para confirmar o pagamento (Dinheiro, Pix ou
        Cartão).
      </P>
      <PBold>Lançar um atendimento feito no balcão (sem passar pelo app):</PBold>
      <Steps
        items={[
          'Toque em "Novo atendimento".',
          "Escolha o barbeiro, digite o nome do cliente e (se quiser) o telefone.",
          "Escolha o(s) serviço(s) e confira o valor.",
          'Escolha o status: pago na hora em Dinheiro, Pix ou Cartão, ou "Pendente" para cobrar depois.',
          'Toque em "Registrar atendimento".',
        ]}
      />
      <P>
        Se o cliente já usa o app e participa de um programa de fidelidade ou de um plano de
        assinatura, ele é reconhecido automaticamente pelo número de telefone digitado: ganha um
        ponto de fidelidade, ou, se ele assina um plano, o atendimento pode sair coberto pelo
        plano (sem cobrar de novo).
      </P>
      <Bullets
        items={[
          'Dá para editar (ícone de lápis) ou excluir (ícone de lixeira) um atendimento já lançado, e também incluir mais de um serviço no mesmo atendimento ("Adicionar serviço").',
          'Também dá para vender produtos da barbearia — botão "Venda de produto".',
          'Em "Relatório de repasse", você acompanha os "Movimentos por forma de pagamento" (Dinheiro, Pix, Cartão e pagamentos online) e o "Total a repassar" por barbeiro, já separado por origem do pagamento. Esse relatório pode ser visto por semana, por mês ou por um período personalizado, e dá para exportar tudo em PDF. (Você também acompanha a venda de produtos realizada pelos barbeiros e/ou venda direta pelo caixa.)',
          'No botão "Ver venda de produtos no caixa", logo abaixo da tabela "Movimentos por forma de pagamento", você vê a lista detalhada das vendas de produto feitas direto no caixa (sem passar por um barbeiro específico): data, produto(s), quantidade, forma de pagamento e valor de cada venda.',
        ]}
      />

      <H2>2.2 Painel</H2>
      <P>
        É uma tela só de consulta de ganhos (individual do barbeiro) — não dá para criar nada
        aqui: mostra cards de faturamento de Hoje, Esta semana e Este mês (com quantos clientes
        foram atendidos em cada um desses três períodos), quantos clientes únicos atenderam nos
        últimos 30 dias, e a lista de atendimentos de hoje e dos próximos dias.
      </P>
      <Note>
        essa tela é a mesma tanto para o barbeiro admin quanto para o barbeiro comum — cada um vê
        só os próprios atendimentos e ganhos.
      </Note>

      <H2>2.3 Agenda</H2>
      <P>
        Mostra a agenda dia a dia de atendimentos. Use as setas para ir para o dia anterior ou o
        próximo.
      </P>
      <PBold>Marcar um cliente manualmente:</PBold>
      <Steps
        items={[
          'Toque em "Novo agendamento".',
          "Preencha nome, WhatsApp e e-mail do cliente.",
          "Escolha o(s) serviço(s) — se o cliente tiver direito a um resgate de fidelidade, a opção aparece aqui.",
          "Confirme o agendamento.",
        ]}
      />
      <P>
        Em cada card de agendamento já existente, você encontra o ícone de lixeira para cancelar
        aquele atendimento, e um botão separado para remarcar (bloquear horários, por exemplo para
        um compromisso fora da barbearia, também fica nessa tela).
      </P>

      <H2>2.4 Clientes</H2>
      <P>
        É o cadastro de clientes da barbearia. O admin vê todos os clientes; um barbeiro comum vê
        só os que atendeu.
      </P>
      <Steps
        items={[
          'Toque em "Novo cliente" (ou equivalente) para cadastrar: Nome, E-mail e WhatsApp.',
          "Use a busca para encontrar um cliente já cadastrado.",
          "Toque em um cliente para editar os dados, ou use a opção de excluir.",
        ]}
      />

      <H2>2.5 Serviços</H2>
      <P>
        É o catálogo de serviços de cada barbeiro (cada barbeiro tem os próprios serviços, com seu
        preço e duração).
      </P>
      <Steps
        items={[
          "Preencha Nome, Duração (em minutos) e Preço do novo serviço.",
          'Toque em "Adicionar".',
          "Para remover um serviço já cadastrado, use o botão de excluir ao lado dele.",
        ]}
      />

      <H2>2.6 Planos</H2>
      <P>
        Aqui você cria planos de assinatura mensal para os SEUS clientes (por exemplo, "corte
        ilimitado por R$ 79,90/mês") — não confunda com a assinatura da própria plataforma, que é
        explicada no capítulo 3.
      </P>
      <Steps
        items={[
          "Defina nome, descrição e preço do plano.",
          "Escolha quais serviços esse plano cobre e quais barbeiros atendem o plano.",
          "Defina a porcentagem de comissão de cada barbeiro nesse plano.",
          "Salve o plano.",
        ]}
      />
      <P>
        A lista de planos já criados mostra o status de cada assinante (Pendente, Autorizada,
        Ativa, Pausada, Cancelada ou Pagamento falhou) e permite abrir um resumo de uso/produção
        do plano.
      </P>

      <H2>2.7 Fidelidade</H2>
      <P>
        Aqui você cria programas de fidelidade (tipo cartão fidelidade: "a cada 10 atendimentos, o
        próximo é grátis").
      </P>
      <Steps
        items={[
          "Defina um nome para o programa.",
          "Escolha o tipo: vale para qualquer atendimento, ou só para serviços específicos.",
          "Defina a meta (por exemplo, 10 atendimentos).",
          "Decida se atendimentos avulsos (lançados direto no Caixa) também contam ponto.",
          "Escolha quais barbeiros e/ou serviços participam.",
          "Defina o prêmio: um atendimento grátis e/ou um produto específico.",
        ]}
      />

      <H2>2.8 Produtos</H2>
      <P>É o catálogo de produtos vendidos na barbearia (ex.: pomada, óleo de barba).</P>
      <Steps
        items={[
          "Preencha título, descrição, preço, foto e quantidade em estoque.",
          "Ative ou desative o produto conforme a disponibilidade.",
        ]}
      />
      <P>
        Um produto que já teve alguma venda registrada não pode ser excluído — nesse caso,
        desative-o em vez de excluir.
      </P>
      <Note>
        um barbeiro comum (não admin) vê, nessa mesma aba, apenas as próprias vendas de produto,
        não o catálogo inteiro.
      </Note>

      <H2>2.9 Horários</H2>
      <P>
        É o horário de funcionamento, dia da semana por dia da semana, com um intervalo de almoço
        opcional.
      </P>
      <Steps
        items={[
          "Marque cada dia da semana como ativo ou inativo.",
          "Defina o horário de início e término de cada dia ativo (e, se quiser, o intervalo de almoço).",
          "Toque em Salvar.",
        ]}
      />

      <H2>2.10 Histórico</H2>
      <P>
        Mostra o histórico de atendimentos já realizados, com filtro por período: Semanal, Mensal
        ou Anual. É só para consulta, não tem ações de criar ou editar.
      </P>

      <H2>2.11 Barbeiros</H2>
      <P>
        Gerenciamento da equipe — o passo a passo de como cadastrar um novo barbeiro está na seção
        1.3 deste manual. Aqui você também promove/revoga administradores e remove barbeiros da
        equipe.
      </P>

      <H2>2.12 Pagamentos</H2>
      <P>
        É onde você conecta o Mercado Pago e configura como o dinheiro é repassado — o passo a
        passo completo está na seção 1.2 deste manual.
      </P>

      <H2>2.13 Ranking</H2>
      <P>
        Mostra um ranking dos barbeiros por faturamento e número de atendimentos, com filtro por
        Hoje, Esta semana, Este mês, Este ano ou um período personalizado.
      </P>
      <Steps
        items={[
          "Escolha o período desejado.",
          "Toque em um barbeiro para ver o detalhe.",
          "Use o botão de download para exportar o ranking.",
        ]}
      />

      <H2>2.14 Perfil</H2>
      <P>
        Reúne os dados da sua conta, o suporte do App Barbearias, o QR Code/link da barbearia
        (seção 1.4) e a sua assinatura da plataforma (capítulo 3).
      </P>
      <H3>Suporte</H3>
      <Steps
        items={[
          'Na aba "Perfil", role até a seção "Suporte".',
          'Toque em "Falar no WhatsApp".',
        ]}
      />
      <P>
        Você é levado direto para uma conversa de WhatsApp com a equipe de suporte, já com uma
        mensagem pronta ("Olá, preciso de ajuda com o App Barbearias").
      </P>
      <H3>Instalando o atalho na tela inicial do celular</H3>
      <P>
        O app não tem uma tela própria dentro do painel para isso — é um passo feito direto pelo
        navegador do celular, fora do app. Veja como fazer em cada aparelho:
      </P>
      <PBold>No iPhone (Safari):</PBold>
      <Steps
        items={[
          "Toque no ícone de compartilhar (o quadrado com uma seta para cima), na barra do navegador.",
          'Toque em "Adicionar à Tela de Início".',
          'Toque em "Adicionar", no canto superior direito.',
        ]}
      />
      <PBold>No Android (Chrome):</PBold>
      <Steps
        items={[
          "Toque nos três pontinhos (⋮), no canto superior direito do navegador.",
          'Toque em "Adicionar à tela inicial" (ou "Instalar aplicativo", dependendo da versão do Chrome).',
          'Confirme tocando em "Adicionar" ou "Instalar".',
        ]}
      />
      <Note>
        existe um aviso automático parecido com esse, só para quem usa iPhone, mas ele aparece
        apenas na tela pública inicial do app (antes de entrar com login), não dentro do painel do
        admin. Não há aviso equivalente para Android.
      </Note>

      <H1>3. Assinatura da plataforma (sua assinatura do App Barbearias)</H1>
      <P>
        Esta seção é sobre a assinatura que SUA barbearia paga para usar o App Barbearias —
        diferente dos planos de assinatura que você vende aos seus próprios clientes (capítulo
        2.6).
      </P>

      <H2>3.1 Planos disponíveis</H2>
      <Bullets
        items={["Mensal — R$ 49,00/mês.", "Anual — R$ 39,00/mês, com compromisso de 12 meses."]}
      />
      <Note>
        apesar do nome "Anual", a cobrança continua sendo feita mês a mês (R$ 39,00 por mês), e
        não como um pagamento único por ano. O compromisso é de ficar 12 meses nesse plano.
      </Note>

      <H2>3.2 Assinando — do teste grátis para o plano pago</H2>
      <P>
        Quando os 7 dias de teste grátis terminam sem uma assinatura paga, o painel inteiro fica
        bloqueado (nenhuma aba abre) até você escolher um plano.
      </P>
      <Steps
        items={[
          'Na tela de bloqueio ("Seu teste grátis acabou"), escolha o plano Mensal ou Anual.',
          'Toque em "Assinar".',
          "Você é levado ao Mercado Pago para autorizar o pagamento recorrente no cartão.",
          'Volte para o app. Enquanto a confirmação não chega, aparece "Aguardando confirmação do pagamento…".',
          "Assim que o Mercado Pago confirma, o painel é liberado normalmente.",
        ]}
      />
      <Note>
        se você é barbeiro da equipe (não admin) e o teste grátis/assinatura da barbearia vence,
        você vê a mensagem "Peça para o administrador da barbearia regularizar a assinatura" — só
        o admin consegue assinar.
      </Note>

      <H2>3.3 Fazendo upgrade do plano Mensal para o Anual</H2>
      <P>
        Só é possível ir do Mensal para o Anual — não existe o caminho inverso (do Anual de volta
        para o Mensal).
      </P>
      <Steps
        items={[
          'Na aba "Perfil", na seção da assinatura da plataforma, toque em "Fazer upgrade para o Anual" (só aparece se você estiver no plano Mensal e com a assinatura ativa).',
          "Confirme o upgrade.",
        ]}
      />
      <P>
        O upgrade não cobra nada na hora: você continua no plano Mensal até a data em que o
        período atual termina. Só depois dessa data é que a cobrança passa a ser R$ 39,00/mês
        automaticamente.
      </P>

      <H2>3.4 Cancelando a assinatura da plataforma</H2>
      <Steps
        items={['Na aba "Perfil", toque no link "Cancelar assinatura".', "Confirme o cancelamento."]}
      />
      <P>
        O cancelamento não tira o acesso na hora: você continua usando o painel normalmente até a
        data em que o período já pago termina. Só depois dessa data o painel fica bloqueado, até
        que uma nova assinatura seja feita.
      </P>

      <H2>3.5 Desfazendo um cancelamento</H2>
      <P>
        Enquanto o acesso ainda não tiver realmente terminado (ou seja, antes da data do fim do
        período pago), dá para voltar atrás:
      </P>
      <Steps
        items={[
          'Na aba "Perfil", toque em "Desfazer cancelamento".',
          "Você é levado de novo ao Mercado Pago para autorizar o pagamento recorrente — não é uma ação instantânea, é preciso autorizar de novo.",
        ]}
      />
      <P>
        Depois que o acesso já tiver terminado de verdade (passou a data), não existe mais
        "desfazer" — o caminho é assinar de novo do zero, como descrito em 3.2.
      </P>

      <H1>4. Guia para o cliente (como seus clientes usam o app)</H1>
      <P>
        Esta parte pode ser compartilhada com seus clientes, ou usada por você para ajudá-los
        quando tiverem dúvida.
      </P>

      <H2>4.1 Acessando pelo link ou QR Code</H2>
      <P>
        Ao abrir o link ou escanear o QR Code da barbearia (seção 1.4), o cliente cai direto numa
        tela de login/cadastro — não existe uma "vitrine" da barbearia visível sem entrar ou criar
        conta primeiro.
      </P>

      <H2>4.2 Criando conta ou entrando</H2>
      <Steps
        items={[
          'Na tela de login, o cliente escolhe entre "Entrar na sua conta" ou "Criar conta de cliente".',
          'Para criar conta: preenche Nome, WhatsApp, E-mail e Senha. Também é possível entrar direto com "Continuar com Google".',
          'Se esqueceu a senha, toca em "Esqueci minha senha" — um link de redefinição é enviado por e-mail.',
        ]}
      />

      <H2>4.3 Tela inicial</H2>
      <P>
        Depois de entrar, o cliente vê o nome da barbearia, um banner para assinar um plano mensal
        (se a barbearia tiver algum plano ativo — ver seção 4.6), produtos à venda, e a lista de
        barbeiros da equipe. Basta tocar em um barbeiro ("Toque para agendar") para começar o
        agendamento.
      </P>

      <H2>4.4 Agendando um horário</H2>
      <P>Depois de escolher o barbeiro, o cliente segue 4 passos na mesma tela:</P>
      <Steps
        items={[
          "Escolher o(s) serviço(s) desejado(s).",
          "Escolher a data.",
          "Escolher o horário disponível.",
          'Confirmar: revisar/editar nome e telefone, usar um resgate de fidelidade se tiver disponível, conferir o resumo (serviço, data, horário e valor) e tocar em "Confirmar agendamento".',
        ]}
      />

      <H2>4.5 Pagamento</H2>
      <P>
        Depois de confirmar, se o atendimento não for gratuito (fidelidade) nem coberto por um
        plano assinado, o cliente cai na tela "Pagamento", com as opções:
      </P>
      <Bullets
        items={[
          '"Pagar Online (Pix ou Cartão)" — abre o checkout do Mercado Pago (só aparece se a barbearia já tiver conectado a própria conta do Mercado Pago).',
          '"Pagar presencialmente" — combina de pagar na hora, na barbearia (só aparece se você tiver deixado essa opção ativada em Pagamentos, seção 1.2).',
        ]}
      />
      <P>
        Depois do pagamento (ou da escolha de pagar presencialmente), aparece uma tela final de
        confirmação com o resumo do agendamento.
      </P>

      <H2>4.6 "Meus agendamentos"</H2>
      <P>É a tela onde o cliente acompanha e gerencia tudo:</P>
      <Bullets
        items={[
          'Minha assinatura — status do plano, data da próxima cobrança, e botão "Cancelar" (o acesso continua até o fim do período já pago).',
          "Fidelidade — progresso dos programas e opção de trocar o resgate por um produto, quando disponível.",
          'Meus pedidos — produtos comprados ou resgatados, com status "Retirado" ou "Aguardando retirada".',
          'Lista de agendamentos futuros — cada um com os botões "Pagar" (se ainda não pago), "Remarcar" e "Cancelar".',
        ]}
      />
      <P>
        No rodapé da tela também fica o link "Excluir conta", para quem quiser apagar o próprio
        cadastro.
      </P>

      <H2>4.7 Assinando um plano mensal da barbearia</H2>
      <Steps
        items={[
          'Na tela inicial, o cliente toca no banner de "Planos de assinatura" (ou acessa esse link direto).',
          "Escolhe um dos planos ativos da barbearia.",
          'Toca em "Assinar".',
          "É levado ao checkout de assinatura do Mercado Pago para autorizar a cobrança mensal recorrente.",
        ]}
      />
      <P>
        Para cancelar depois, o cliente usa o botão "Cancelar" dentro de "Meus agendamentos"
        (seção 4.6) — não há botão de cancelar na própria tela de assinatura.
      </P>

      <H2>4.8 Programa de fidelidade</H2>
      <P>
        O cliente acompanha o progresso e resgata o prêmio em dois lugares: durante o próprio
        agendamento (quando já tem direito a um resgate, aparece a opção na hora de confirmar —
        seção 4.4) e na tela "Meus agendamentos" (seção 4.6), onde também pode trocar o resgate
        por um produto, se o programa permitir.
      </P>

      <H1>5. Dúvidas frequentes</H1>
      <Faq
        q="O cliente não consegue pagar online, o que fazer?"
        a='Confira primeiro se a conta do Mercado Pago da barbearia está mesmo conectada (aba Pagamentos). Se estiver tudo certo do seu lado, oriente o cliente a tentar novamente pela tela "Pagamento", ou, se você tiver deixado essa opção ativada, a escolher "Pagar presencialmente" e pagar na hora, na barbearia.'
      />
      <Faq
        q="Como cancelo um agendamento?"
        a='Pelo lado do cliente, é feito em "Meus agendamentos", no botão "Cancelar" de cada agendamento. Pelo lado do admin, é feito na aba Agenda: toque no ícone de lixeira no card do agendamento que você quer cancelar. Para remarcar em vez de cancelar, use o botão separado de remarcar, no mesmo card.'
      />
      <Faq
        q="Esqueci minha senha, e agora?"
        a="Na tela de login, toque em “Esqueci minha senha” e informe o seu e-mail. Você vai receber um link para criar uma nova senha. Esse caminho vale tanto para contas de cliente quanto para contas de barbeiro/admin, já que é a mesma tela de login."
      />
      <Faq
        q="Preciso conectar o Mercado Pago para usar o app?"
        a="Não é obrigatório para começar a usar o painel, mas sem conectar: seus clientes não conseguem pagar online (Pix/cartão) pelo app, e você também não consegue vender planos de assinatura (nem para seus clientes, nem para a sua própria assinatura da plataforma) — todos esses pagamentos dependem do Mercado Pago."
      />
      <Faq
        q="O que acontece se eu não pagar a assinatura da plataforma?"
        a="Quando o período pago (ou o teste grátis de 7 dias) termina sem uma assinatura ativa, o painel inteiro fica bloqueado — nenhuma aba abre — até você assinar um plano (seção 3.2)."
      />
      <Faq
        q="Dá para eu ter mais de uma barbearia no mesmo app?"
        a="O cadastro inicial (seção 1.1) impede criar uma nova barbearia pela mesma conta se ela já tiver uma — ou seja, cada conta de e-mail está ligada a uma única barbearia por esse fluxo."
      />
      <Faq
        q="O cliente consegue agendar sem criar conta?"
        a="Não é esse o caminho pensado no app hoje: ao abrir o link da barbearia, o cliente sempre é levado primeiro para a tela de login/cadastro (seção 4.1 e 4.2)."
      />
    </div>
  );
}

export function ManualSection() {
  const [open, setOpen] = useState(false);

  return (
    <section className="surface space-y-3 p-4">
      <div className="flex items-center gap-2">
        <BookOpen className="text-muted-foreground" size={18} />
        <h2 className="font-semibold">Manual do app</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Veja o passo a passo de como usar o App Barbearias: primeiro acesso, cada aba do painel,
        a assinatura da plataforma e como o cliente usa o app.
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline">
            <BookOpen /> Ver manual
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manual do App Barbearias</DialogTitle>
            <DialogDescription>
              Guia para o barbeiro admin (dono da barbearia) e para o cliente
            </DialogDescription>
          </DialogHeader>
          <ManualBody />
        </DialogContent>
      </Dialog>
    </section>
  );
}
