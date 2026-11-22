/**
 * Camada de banco transacional do backend (fases 2.9 → 3.0).
 *
 * Usa `bun:sqlite` (embutido no Bun, sem infra extra). O estado autoritativo do razão fica em `orgs.ledger_json`;
 * as tabelas `events` (UNIQUE org+idempotency_key), `settlements` (UNIQUE org+op_id) e `audit` (append-only)
 * impõem idempotência durável e trilha imutável. Todas as mutações financeiras rodam em transações SQLite.
 *
 * Resiliência (P1.2): `busy_timeout` para contenção entre processos, `journal_mode=WAL` para durabilidade,
 * e migrações SQL versionadas e repetíveis (`schema_migrations`).
 */
import { Database } from 'bun:sqlite'
import type { AuditRecord, FinancialEvent, LedgerState } from '../src/lib/accounting/types'

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE orgs (
    org_id TEXT PRIMARY KEY,
    ledger_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE events (
    org_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (org_id, idempotency_key)
  );
  CREATE TABLE settlements (
    org_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    settlement_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (org_id, op_id)
  );
  CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT NOT NULL,
    at TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL
  );
  `,
]

export class LedgerDb {
  readonly db: Database
  readonly path: string

  constructor(path = ':memory:') {
    this.path = path
    this.db = new Database(path)
    this.db.exec('PRAGMA foreign_keys = ON')
    // Contenção entre processos/abas: espera até 5s por lock antes de falhar.
    this.db.exec('PRAGMA busy_timeout = 5000')
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    const applied = new Set(
      (this.db.query('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
    )
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

  /** Insere/atualiza um evento (constraint UNIQUE em org+idempotency_key preserva o mesmo evento em reprocessamento). */
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

  /** Registra uma liquidação com constraint UNIQUE (org, op_id): uma operação = uma liquidação. */
  insertSettlement(orgId: string, opId: string, settlementId: string, payload: string, now: string): void {
    this.db
      .query('INSERT INTO settlements (org_id, op_id, settlement_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(orgId, opId, settlementId, payload, now)
  }

  hasSettlementByOp(orgId: string, opId: string): boolean {
    return this.db.query('SELECT 1 FROM settlements WHERE org_id = ? AND op_id = ?').get(orgId, opId) !== null
  }

  getSettlement(orgId: string, opId: string): { settlementId: string; payload: string } | null {
    const row = this.db.query('SELECT settlement_id, payload_json FROM settlements WHERE org_id = ? AND op_id = ?').get(orgId, opId) as { settlement_id: string; payload_json: string } | undefined
    return row ? { settlementId: row.settlement_id, payload: row.payload_json } : null
  }

  close(): void {
    this.db.close()
  }
}
