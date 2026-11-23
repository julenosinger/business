# Fase UI 1.0: Redesign empresarial dos formulários de cadastro

**HEAD inicial:** `74eb3de` (Fase 3.3) · **HEAD final:** `(commit desta fase)`

Resultado: **317 testes passando**, typecheck (app + servidor) limpo, lint limpo, build de produção OK. Nenhuma alteração de lógica/validação.

---

## 1. Objetivo

Modernizar visualmente quatro modais de cadastro, mantendo integralmente campos, validações, parsing, precisão monetária e handlers de salvar/cancelar/editar.

## 2. Arquivos criados / modificados

**Criados**
- `src/components/form.tsx` — componentes compartilhados: `FormSection` (seção com título discreto + ícone), `FormFooter` (rodapé com cancelar/salvar, estados e conteúdo à esquerda) e `EnvironmentBadge` (indicador de ambiente somente leitura).

**Modificados**
- `src/components/ui.tsx` — `Modal` ganhou `subtitle`, `icon` e `size` (opcionais, retrocompatíveis) com cabeçalho aprimorado e largura `form` (~720 px); `Field` ganhou `required` (asterisco visual).
- `src/pages/Finance.tsx` — `AccountModal` reorganizado em seções.
- `src/pages/Employees.tsx` — `EmployeeModal` reorganizado em seções.
- `src/pages/Contacts.tsx` — `ContactModal` (cliente/fornecedor) reorganizado em seções.

## 3. Mudanças visuais

| Modal | Seções |
| --- | --- |
| Nova conta | Tipo de conta (pagar/receber) · Identificação (descrição + credor/cliente) · Classificação (categoria) · Condições financeiras (valor + vencimento) |
| Novo funcionário | Identificação (nome) · Dados profissionais (cargo + admissão) · Remuneração (salário) · Pagamento digital (carteira USDC) |
| Novo cliente / fornecedor | Identificação (nome + CPF/CNPJ) · Contato (telefone + e-mail) · Pagamento digital (carteira USDC) |

- Cabeçalho com ícone por tipo de cadastro, título + subtítulo contextual e botão fechar discreto.
- Largura desktop ~720 px, altura adaptativa com limite da viewport; mobile mantém bottom sheet da arquitetura existente.
- Grid responsivo (uma coluna no mobile, duas no desktop).
- Rodapé com ações à direita + `EnvironmentBadge` à esquerda (Arc Mainnet · Produção / Arc Testnet · Testes).
- Inputs com placeholders úteis, tipografia `num`/`mono` onde aplicável, indicador de obrigatório (`*`) e mensagens de validação próximas ao campo.

## 4. Funcionalidades preservadas (inalteradas)

- Payloads de criação/edição, `disabled` conditions, handlers de salvar/cancelar/editar, máscaras, `DateField`, `isValidAddress`, `parseNum`, isolamento Mainnet/Testnet e persistência.

## 5. Testes

- Suíte completa: **317 pass, 0 fail** (sem regressão). A fase é exclusivamente visual; não há nova lógica de negócio a testar em unidade. Validações de formulário já cobertas pelos testes existentes permanecem inalteradas.

## 6. Validação

- Light/Dark: usa tokens do design system (sem cores hardcoded).
- PT/EN: todos os textos via `t()`.
- Desktop/mobile/tablet: grid responsivo, sem overflow horizontal, teclado virtual respeitado.
- Acessibilidade: foco visível, `aria-pressed` nos seletores de tipo, labels associados, Escape para fechar.

## 7. Riscos residuais

- Nenhum. Sem alteração de dados, validações, operações ou relacionamentos.

## 8. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>` (mudanças apenas de apresentação).
