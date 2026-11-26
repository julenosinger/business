/**
 * Camada de banco transacional do backend (fases 2.9 → 3.1).
 *
 * Usa `bun:sqlite`. O estado autoritativo do razão fica em `orgs.ledger_json`; as tabelas `events`,
 * `settlements` e `audit` impõem idempotência durável e trilha imutável.
 *
 * Segurança de liquidação (fase 3.1):
 * - `settlements` tem PK `(org_id, op_id)` E índice UNIQUE na identidade canônica da transferência
 *   `(org_id, chain_id, tx_hash, transfer_to, amount_minor)`, impedindo reutilizar a mesma evidência
 *   on-chain em operações diferentes (sem bloquear transferências distintas legítimas).
 * - O registro preserva o resultado original (entry_id, allocated/excess) para retorná-lo em retries idênticos.
 *
 * Resiliência: `busy_timeout`, WAL, migrações versionadas e reparo de schema legado (fase 2.9/3.0 → 3.1)
 * sem perda de dados.
 */
import { Database } from 'bun:sqlite'
import type { AuditRecord, FinancialEvent, LedgerState } from '../src/lib/accounting/types'

const SETTLEMENTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS settlements (
    org_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    settlement_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    entry_id TEXT,
    allocated_minor TEXT NOT NULL,
    excess_minor TEXT NOT NULL,
    currency TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    transfer_to TEXT NOT NULL,
    amount_minor TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (org_id, op_id)
  )
`

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS orgs (
    org_id TEXT PRIMARY KEY,
    ledger_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    org_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (org_id, idempotency_key)
  );
  ${SETTLEMENTS_SCHEMA};
  CREATE UNIQUE INDEX IF NOT EXISTS settlements_evidence ON settlements (org_id, chain_id, tx_hash, transfer_to, amount_minor);
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    at TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL
  );
  `,
  // v2 — checkout comercial Circle Gateway (FIN-04.1B.2.2B.1): persistência compartilhada.
  `
  CREATE TABLE IF NOT EXISTS payment_intents (
    intent_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('mainnet', 'testnet')),
    account_id TEXT NOT NULL,
    sale_id TEXT,
    customer_id TEXT,
    chain_id INTEGER NOT NULL,
    token_address TEXT NOT NULL,
    gateway_wallet TEXT NOT NULL,
    depositor TEXT,
    currency TEXT NOT NULL,
    amount_minor TEXT NOT NULL,
    usdc_minor TEXT NOT NULL,
    exchange_rate TEXT,
    idempotency_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    state TEXT NOT NULL,
    company TEXT,
    description TEXT,
    reference TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    UNIQUE (organization_id, environment, idempotency_key)
  );
  CREATE TABLE IF NOT EXISTS payment_reservations (
    reservation_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL UNIQUE,
    organization_id TEXT NOT NULL,
    environment TEXT NOT NULL,
    account_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount_minor TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (intent_id) REFERENCES payment_intents(intent_id)
  );
  CREATE TABLE IF NOT EXISTS payment_attempts (
    attempt_id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    environment TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    payer TEXT,
    state TEXT NOT NULL,
    approval_hash TEXT,
    deposit_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (intent_id) REFERENCES payment_intents(intent_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS payment_deposit_hash_unique ON payment_attempts (environment, chain_id, deposit_hash) WHERE deposit_hash IS NOT NULL;
  CREATE TABLE IF NOT EXISTS checkout_tokens (
    token_hash TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (intent_id) REFERENCES payment_intents(intent_id)
  );
  CREATE INDEX IF NOT EXISTS payment_intents_account_idx ON payment_intents (organization_id, environment, account_id);
  `,
  // v3 — campos de submissão da tentativa (persistência pré-assinatura, FIN-04.1B.2.2B.3).
  `
  ALTER TABLE payment_attempts ADD COLUMN submission_started_at TEXT;
  ALTER TABLE payment_attempts ADD COLUMN submitted_at TEXT;
  `,
]

export interface SettlementRecord {
  opId: string
  settlementId: string
  accountId: string
  entryId: string | null
  allocatedMinor: string
  excessMinor: string
  currency: string
  chainId: number
  txHash: string
  transferTo: string
  amountMinor: string
}

function mapSettlement(row: Record<string, unknown> | undefined): SettlementRecord | null {
  if (!row) return null
  return {
    opId: String(row.op_id ?? ''),
    settlementId: String(row.settlement_id ?? ''),
    accountId: String(row.account_id ?? ''),
    entryId: row.entry_id == null ? null : String(row.entry_id),
    allocatedMinor: String(row.allocated_minor ?? '0'),
    excessMinor: String(row.excess_minor ?? '0'),
    currency: String(row.currency ?? ''),
    chainId: Number(row.chain_id ?? 0),
    txHash: String(row.tx_hash ?? ''),
    transferTo: String(row.transfer_to ?? ''),
    amountMinor: String(row.amount_minor ?? '0'),
  }
}

export class LedgerDb {
  readonly db: Database
  readonly path: string

  constructor(path = ':memory:') {
    this.path = path
    this.db = new Database(path)
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    // Repara schema legado ANTES das migrações versionadas (para bancos da fase 2.9/3.0).
    this.repairLegacySettlements()
    const applied = new Set((this.db.query('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version))
    const insert = this.db.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
    const tx = this.db.transaction(() => {
      MIGRATIONS.forEach((sql, i) => {
        const version = i + 1
        if (applied.has(version)) return
        this.db.exec(sql)
        insert.run(version, new Date().toISOString())
      })
    })
    tx()
  }

  /** Repara o schema legado de `settlements` (fase 2.9/3.0) preservando os dados, sem DROP destrutivo. */
  private repairLegacySettlements(): void {
    const cols = this.db.query('PRAGMA table_info(settlements)').all() as { name: string }[]
    if (cols.length === 0) return // tabela ainda não existe (banco novo)
    const names = new Set(cols.map((c) => c.name))
    if (names.has('chain_id') && names.has('entry_id') && names.has('transfer_to')) return // já no schema novo
    const tx = this.db.transaction(() => {
      this.db.exec('ALTER TABLE settlements RENAME TO settlements_legacy')
      this.db.exec(SETTLEMENTS_SCHEMA)
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS settlements_evidence ON settlements (org_id, chain_id, tx_hash, transfer_to, amount_minor)')
      this.db.exec(`
        INSERT INTO settlements (org_id, op_id, settlement_id, account_id, entry_id, allocated_minor, excess_minor, currency, chain_id, tx_hash, transfer_to, amount_minor, payload_json, created_at)
        SELECT org_id, COALESCE(op_id, settlement_id), COALESCE(settlement_id, op_id), '', NULL, '0', '0', '', 0, '', '', '0', payload_json, created_at
        FROM settlements_legacy
      `)
      this.db.exec('DROP TABLE settlements_legacy')
    })
    tx()
  }

  loadLedger(orgId: string): LedgerState | null {
    const row = this.db.query('SELECT ledger_json FROM orgs WHERE org_id = ?').get(orgId) as { ledger_json: string } | undefined
    return row ? (JSON.parse(row.ledger_json) as LedgerState) : null
  }

  saveLedger(orgId: string, ledger: LedgerState, now: string): void {
    this.db
      .query('INSERT INTO orgs (org_id, ledger_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(org_id) DO UPDATE SET ledger_json = excluded.ledger_json, updated_at = excluded.updated_at')
      .run(orgId, JSON.stringify(ledger), now)
  }

  getEvent(orgId: string, idempotencyKey: string): FinancialEvent | null {
    const row = this.db.query('SELECT payload_json FROM events WHERE org_id = ? AND idempotency_key = ?').get(orgId, idempotencyKey) as { payload_json: string } | undefined
    return row ? (JSON.parse(row.payload_json) as FinancialEvent) : null
  }

  insertEvent(orgId: string, event: FinancialEvent): void {
    this.db
      .query(
        'INSERT INTO events (org_id, idempotency_key, event_id, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(org_id, idempotency_key) DO UPDATE SET payload_json = excluded.payload_json, status = excluded.status',
      )
      .run(orgId, event.idempotencyKey, event.id, JSON.stringify(event), event.status, event.createdAt)
  }

  insertAudit(orgId: string, records: AuditRecord[]): void {
    const stmt = this.db.query('INSERT INTO audit (org_id, at, action, detail) VALUES (?, ?, ?, ?)')
    for (const r of records) stmt.run(orgId, r.at, r.action, r.detail)
  }

  insertSettlement(orgId: string, rec: SettlementRecord & { payload: string; createdAt: string }): void {
    this.db
      .query(
        `INSERT INTO settlements (org_id, op_id, settlement_id, account_id, entry_id, allocated_minor, excess_minor, currency, chain_id, tx_hash, transfer_to, amount_minor, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(orgId, rec.opId, rec.settlementId, rec.accountId, rec.entryId, rec.allocatedMinor, rec.excessMinor, rec.currency, rec.chainId, rec.txHash, rec.transferTo, rec.amountMinor, rec.payload, rec.createdAt)
  }

  getSettlementByOp(orgId: string, opId: string): SettlementRecord | null {
    const row = this.db.query('SELECT * FROM settlements WHERE org_id = ? AND op_id = ?').get(orgId, opId) as Record<string, unknown> | undefined
    return mapSettlement(row)
  }

  getSettlementByEvidence(orgId: string, chainId: number, txHash: string, transferTo: string, amountMinor: string): SettlementRecord | null {
    const row = this.db
      .query('SELECT * FROM settlements WHERE org_id = ? AND chain_id = ? AND tx_hash = ? AND transfer_to = ? AND amount_minor = ?')
      .get(orgId, chainId, txHash, transferTo, amountMinor) as Record<string, unknown> | undefined
    return mapSettlement(row)
  }

  close(): void {
    this.db.close()
  }
}
