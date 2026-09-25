/**
 * Imagens de fundo do app. Valores guardados em barbers.bg_home / bg_tabs:
 *  - null          → padrão (tela inicial: fundo-3; demais abas: cor do app)
 *  - "cor"         → sem imagem, só a cor padrão do tema (escuro ou claro)
 *  - "preset-N"    → uma das imagens que já vêm com o app
 *  - "https://..." → imagem própria enviada pelo barbeiro
 */

export const BG_PLAIN = "cor";

export const PRESET_BACKGROUNDS = Array.from({ length: 6 }, (_, i) => ({
  id: `preset-${i + 1}`,
  url: `/backgrounds/fundo-${i + 1}.jpg`,
  label: `Imagem ${i + 1}`,
}));

/** Fundo padrão da tela inicial do celular (terceira imagem). */
export const DEFAULT_HOME_BG = "preset-3";

/** Fundo fixo da tela de login (mesma terceira imagem). */
export const LOGIN_BG_URL = "/backgrounds/fundo-3.jpg";

/** URL da imagem pra um valor salvo, ou null quando é só a cor do tema. */
export function backgroundUrl(value: string | null | undefined): string | null {
  if (!value || value === BG_PLAIN) return null;
  const preset = PRESET_BACKGROUNDS.find((p) => p.id === value);
  if (preset) return preset.url;
  // Imagem própria: só http(s), e com os caracteres que poderiam fechar o
  // url(...) do CSS escapados.
  if (!/^https?:\/\//i.test(value)) return null;
  return encodeURI(value).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29");
}
