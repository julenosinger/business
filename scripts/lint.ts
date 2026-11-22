/**
 * Executa o lint em duas etapas (com e sem info de tipos), de forma compatível com
 * Windows/macOS/Linux. Substitui o script bash original (`$?` / `$(())`), que não roda no
 * PowerShell/cmd do Windows.
 *
 * - Etapa 1: `oxlint --type-aware src scripts --fix` (erros que exigem inferência de tipos).
 * - Etapa 2: `oxlint --fix .` (todo o projeto).
 * - O código de saída é o da primeira etapa que falhar; ambas sempre rodam.
 */
import { spawnSync } from 'node:child_process'

function run(args: string[]): number {
  const r = spawnSync('bun', ['x', 'oxlint', ...args], { stdio: 'inherit' })
  return r.status ?? 1
}

const first = run(['--type-aware', 'src', 'scripts', '--fix'])
const second = run(['--fix', '.'])
process.exit(first !== 0 ? first : second)
