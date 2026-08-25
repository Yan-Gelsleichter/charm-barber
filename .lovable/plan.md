# Persistência autoritativa de agendamentos e pagamentos

## Objetivo
Eliminar referências temporárias do checkout e impedir que qualquer tela anuncie sucesso antes de confirmar a linha persistida no banco.

## Alterações
- Tornar `/api/public/appointment-create` a única porta de criação e exigir confirmação de `appointments` e `clients` antes da resposta de sucesso; tratar falhas sem aceitar registros parciais.
- Remover o uso de `localStorage` para guardar a preferência do Mercado Pago; usar somente `mp_payment_id` persistido no agendamento.
- No pagamento presencial, remover updates/fallbacks feitos pelo navegador e confirmar no servidor a linha atualizada antes de navegar.
- Nas telas de pagamento e confirmação, derivar o status somente da consulta ao banco; Realtime e reconciliação apenas disparam uma nova leitura, sem definir sucesso localmente.
- Manter painel e “Meus agendamentos” abastecidos por consultas ao banco e invalidar/refazer as consultas depois das mutações.

## Validação
- Verificar que não restam gravações alternativas de `appointments`/`clients` no fluxo de criação.
- Verificar que não há `localStorage` no checkout.
- Testar criação, pagamento presencial e tela de confirmação no navegador, além de checar build e erros de runtime.

## Detalhes técnicos
- A atomicidade principal continuará na função SQL `create_appointment_with_client`; a API rejeitará sucesso se não conseguir confirmar as duas linhas.
- O webhook continuará atualizando `appointments` de forma síncrona e o cliente só exibirá “pago” após reler `payment_status = pago` do banco.
