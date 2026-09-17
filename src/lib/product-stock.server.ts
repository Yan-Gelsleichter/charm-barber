/**
 * Desconto de estoque — só quando um pedido de produto é confirmado como
 * pago (webhook, venda presencial já paga, ou marcar pendente como pago),
 * nunca na criação do pedido. Usa a função `decrement_product_stock` do
 * Postgres (docs/add-products.sql) em vez de ler e regravar o valor no
 * código do servidor, porque um único UPDATE no banco é atômico — evita
 * vender a mesma unidade duas vezes se dois pagamentos confirmarem ao
 * mesmo tempo.
 */

type Admin = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> };

export async function decrementProductStock(admin: Admin, productId: string, qty: number): Promise<void> {
  const { error } = await admin.rpc("decrement_product_stock", {
    p_product_id: productId,
    p_qty: qty,
  });
  if (error) {
    console.error("[product-stock] falha ao descontar estoque", { productId, qty, error });
  }
}

export async function decrementProductStockForItems(
  admin: Admin,
  items: { product_id: string; quantity: number }[],
): Promise<void> {
  await Promise.all(items.map((item) => decrementProductStock(admin, item.product_id, item.quantity)));
}
