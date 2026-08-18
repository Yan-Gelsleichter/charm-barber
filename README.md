# Barber Connect

Quero criar um app de agendamento de barbearia. Antes de começar a construir as telas, 
preciso que você configure a conexão com meu banco de dados Supabase (usarei minha própria instância). 
Aqui estão os dados para conexão com a URL e Anon Key: 
URL: https://axuvfztbyfmswpcveujo.supabase.co
Anon Key: sb_publishable_pdUbjMiCu-ZXE6K2kh_umA_AjwtS9Oa

"Ao conectar o Supabase, utilize a estrutura das tabelas que já criei:

Tabela barbers (barbeiros) : Use para listar os profissionais, exibir seus perfis e validar o login administrativo.

Tabela services (serviços) : Use para popular a lista de serviços oferecidos, exibindo nome, duração e preço para o cliente.

Tabela appointments (agendamentos) : Use para salvar os novos agendamentos realizados pelos clientes, vinculando corretamente o barber_id, o serviço escolhido e a data/hora selecionada.

Por favor, certifique-se de que todos os formulários de agendamento e os dashboards 
de exibição de dados estejam mapeados diretamente para essas tabelas e colunas específicas." 
Após conectar o supabase, quero que estruture as telas conforme instruções abaixo:

crie um sistema completo de barbearia com agendamento de horários. 

perfis de usuário:

barbeiro: defina seus horários de trabalho (dias de semana e intervalos de atendimento). 
Cadastre os serviços oferecidos , informando o nome, duração media e preço. 
Possui um dashboard financeiro com resumo de ganhos diários, semanais e mensais. 
Conta com uma agenda visual para acompanhar os horários marcados horários livres e cancelamentos.
O barbeiro admim quem pode cadastrar outros barbeiros. 

Cliente: visualiza os barbeiros e seus serviços. 
Seleciona o serviço desejado e agenda um horário com base na disponibilidade do barbeiro e 
no tempo de procedimento (quando o horário já esta reservado para outro cliente, mostrar o campo como indisponivel, riscado). 
Recebe confirmação e lembrete do agendamento. 

Requisitos adicionais: o sistema deve calcular automaticamente os horários disponíveis com base na duração 
dos serviços e na agenda do barbeiro. Interface amigável, otimizada para celular, 
Use cores mais dark e padrão apple, com cores preincipais em degrade azul para verde, e bordas suaves. 
Cada usuário deve ter login e senha. 
O painel do barbeiro deve permitir editar horários, serviços e visualizar o histórico de atendimentos.

Login: Nome 'VIP BARBER' no topo, subtítulo 'Seja bem-vindo'. 
Inclua sugestões rápidas de provedores de e-mail (ex: @gmail.com, @yahoo.com).

Cadastro: Implemente máscaras de input para telefone e e-mail.

Na tela de criar conta coloque uma mascara de telefone e tambem para os emails.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://charm-barber.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f8e58623-77fe-4f6a-9a93-94bca800c277).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
