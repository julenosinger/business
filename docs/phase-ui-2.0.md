# Fase UI 2.0: Enriquecimento dos cadastros empresariais

**HEAD inicial:** `515c669` (Fase UI 1.0) · **HEAD final:** `(commit desta fase)`

Resultado: **323 testes passando** (eram 317), typecheck (app + servidor) limpo, lint limpo, build de produção OK.

---

## 1. Objetivo

Evoluir Clientes, Fornecedores, Funcionários e Contas a Pagar/Receber com campos opcionais organizados em seções, mantendo compatibilidade retroativa e zero regressão.

## 2. Arquivos criados / modificados

**Criados**
- `src/lib/documents.ts` — máscaras e validação de CPF/CNPJ (`maskCpf`, `maskCnpj`, `isValidCpf`, `isValidCnpj`, `isDocValid`) e email (`isEmailValid`). Validação proporcional: vazio/incompleto é aceito (campos opcionais).
- `tests/documents.test.ts` — 6 testes das máscaras e validações.

**Modificados**
- `src/lib/types.ts` — novos campos opcionais em `Contact`, `Employee` e `Account`; novos tipos `PersonType` e `ContactAddress`.
- `src/components/form.tsx` — novos componentes `FormAccordion`, `FormHelpText`, `FormFieldError`.
- `src/pages/Contacts.tsx` — `ContactModal` enriquecido (tipo de pessoa, CPF/CNPJ mascarado, endereço, informações adicionais, status).
- `src/pages/Employees.tsx` — `EmployeeModal` enriquecido (matrícula, departamento, email, telefone, vínculo, centro de custo, observações).
- `src/pages/Finance.tsx` — `AccountModal` enriquecido (documento, emissão, competência, referência externa, observações, recorrência) e **correção** do seletor de contato para respeitar o ambiente (P6/auditoria UI 1.0).

## 3. Campos adicionados

| Cadastro | Novos campos opcionais |
| --- | --- |
| Cliente / Fornecedor | `personType`, `legalName`, `internalCode`, `secondaryPhone`, `contactPersonName`, `contactPersonRole`, `address` (CEP/logradouro/número/complemento/bairro/cidade/estado/país), `notes`, `paymentTerms`, `active` |
| Funcionário | `registration`, `department`, `email`, `phone`, `contractType`, `costCenter`, `notes` |
| Conta a pagar/receber | `documentNumber`, `issuedAt`, `competence`, `notes`, `externalRef`, `recurring` |

Todos opcionais, sem migração (registros legados permanecem legíveis/editáveis). Novos campos não alteram cálculo salarial, folha, liquidação, conciliação ou razão contábil.

## 4. Componentes e organização

- Seções sempre visíveis para os campos principais; `FormAccordion` para dados adicionais (Endereço, Informações adicionais).
- CPF/CNPJ com máscara e dígitos verificadores; email com validação de formato; carteira USDC com `isValidAddress` preservado.
- Explicação de que cadastrar carteira **não** autoriza pagamentos.
- Recorrência é indicador informativo (nenhum agendamento automático).

## 5. Isolamento Mainnet/Testnet

- Preservado integralmente (fases 3.2.x/3.3).
- Corrigido o seletor de contato no `AccountModal` (Finance), que agora usa `contactsForEnvironment` — nenhum cadastro de outro ambiente aparece em seletores.

## 6. Testes

- Novos: 6 (`tests/documents.test.ts`).
- Suíte completa: **323 pass, 0 fail** (nenhuma regressão).

## 7. Compatibilidade e riscos

- Compatível com registros anteriores (todos os novos campos são opcionais e ausência não gera erro).
- `address` é armazenado como objeto mesmo vazio (inofensivo); campos de texto vazios opcionais são normalizados para `undefined` no payload da conta.
- Sem riscos contábeis/financeiros: nenhuma regra de negócio alterada.

## 8. Implantação e rollback

- App: `bun install && bun run build`.
- Rollback: `git revert <commit da fase>`.
