/**
 * O navegador usa exclusivamente o banco configurado para este projeto.
 * Não mantenha URL ou chave de outro banco como fallback: isso faria o painel
 * ler linhas diferentes das confirmadas pela API de criação.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env
  .VITE_SUPABASE_PUBLISHABLE_KEY as string;
