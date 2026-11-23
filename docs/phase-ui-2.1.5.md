# Fase UI 2.1.5: Logistics Result Integrity & Final Regression Hardening

**HEAD inicial:** `f03652e` (Fase UI 2.1.4) · **HEAD final:** `cd987cd`

Resultado: **372 testes passando** (eram 366), typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma alteração visual.

---

## 1. Causa-raiz (P1)

`runShipmentOp()` pré-validava com `op(data, now)` (snapshot da renderização) e reexecutava `op(d, now)` dentro de `apply`, retornando o `value` da **primeira** execução. Quando `data` e `dataRef.current` divergiam, a segunda execução podia rejeitar (sem gravar) enquanto o método retornava `{ ok: true }` com um resultado que não correspondia ao commit — falso sucesso e dupla execução da operação.

## 2. Correção

`runShipmentOp()` agora:

```ts
const out = op(dataRef.current, now)   // uma única avaliação sobre o snapshot autoritativo
if (!out.ok) return out
apply(() => out.data)                  // integra o estado já calculado (com autoPost)
return { ok: true, value: out.value }  // valor corresponde exatamente ao commit
```

- Avaliação **única** por tentativa.
- Validação e commit usam o **mesmo snapshot** (`dataRef.current`).
- `apply(() => out.data)` preserva `autoPost` (sincronização contábil) sem reexecutar a operação.
- Rejeição retorna erro real; nenhum efeito colateral é duplicado.

## 3. Integridade da Logística (P2)

Preservada: criação/atualização de remessas, mudanças de status, recebimentos, movimentações de estoque, quantidades, relacionamentos, IDs, histórico, integração Financeiro/Contabilidade e isolamento Mainnet/Testnet.

## 4. Arquivos

**Modificados:** `src/lib/store.tsx`.
**Criados:** `tests/store-logistics.test.ts`, `docs/phase-ui-2.1.5.md`.

## 5. Testes (P3)

Novos 6, em `tests/store-logistics.test.ts` (montando o `StoreProvider` real com happy-dom + `react-dom/client` + `act`):

1. Criação válida retorna sucesso e altera o estado.
2. Operação inválida retorna erro sem modificar o estado.
3. Resultado retornado corresponde ao commit (ID da remessa).
4. Duas operações rápidas no mesmo ciclo não duplicam remessas (IDs distintos).
5. Atualizações intercaladas entre Logística e Estoque não se perdem.
6. Isolamento Mainnet/Testnet em remessas.

Suíte completa: **372 pass, 0 fail** (nenhuma regressão).

## 6. Limitações

- Sem backend transacional: durabilidade é `localStorage` (sem confirmação síncrona); exclusividade entre dispositivos não garantida.
- Testes reais exercitam o fluxo defeituoso corrigido via o `StoreProvider` real.

## 7. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
