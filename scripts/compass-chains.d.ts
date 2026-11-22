/**
 * Declaração de tipo para a dependência interna do Arc Studio `@circlefin/compass-chains`.
 *
 * O script de deploy `scripts/compass-deploy.ts` importa este pacote (escopo interno do Arc Studio,
 * não publicado no npm público). Ele NÃO faz parte do app em `src/` — é uma ferramenta de deploy.
 * Esta declaração ambiente apenas resolve o módulo para o `tsc`/`oxlint` conseguirem checar o script;
 * não há código em runtime.
 */
declare module '@circlefin/compass-chains' {
  export interface CompassChain {
    name: string
    explorerUrl?: string
    nativeCurrency: { symbol: string }
  }
  export function getChain(id: string): CompassChain
}
