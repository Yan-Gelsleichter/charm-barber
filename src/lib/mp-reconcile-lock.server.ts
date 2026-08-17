/**
 * Coalescência de reconciliações concorrentes.
 *
 * A tela de confirmação faz polling a cada 2s e o usuário pode ter várias abas
 * abertas. Sem isso, N requisições simultâneas consultariam o Mercado Pago e
 * escreveriam o mesmo status repetidas vezes no agendamento.
 *
 * Requisições para o mesmo agendamento compartilham a MESMA promise enquanto a
 * primeira ainda está em andamento.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function withReconcileLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    try {
      return await run();
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise as Promise<unknown>);
  return promise;
}
