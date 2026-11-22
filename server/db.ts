/**
 * Camada de banco transacional do backend (fase 2.9).
 *
 * Usa `bun:sqlite` (embutido no Bun, sem dependências extras nem custo de infra).
 * O estado autoritativo do razão fica em `orgs.ledger_json`; as tabelas `events`,
 * `settlements` e `audit` impõem idempotência durável (constraints UNIQUE) e trilha imutável.
 *
 * Finanças são mutadas APENAS em transações SQLite (atômico: tudo ou nada).
 */
import { Database } from 'bun:sqlite'
import type { AuditRecord, FinancialEvent, LedgerState } from '../src/lib/accounting/types'

export class LedgerDb {
  readonly db: Database

  constructor(path = ':memory:') {
    this.db = new Database(path)
    this.db.exec('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
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
      CREATE TABLE IF NOT EXISTS settlements (
        org_id TEXT NOT NULL,
        settlement_id TEXT NOT NULL,
        op_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (org_id, settlement_id)
      );
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id TEXT NOT NULL,
        at TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL
      );
    `)
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

  /** Registra uma liquidação com constraint UNIQUE (org, settlement_id). Lança em caso de duplicata. */
  insertSettlement(orgId: string, settlementId: string, opId: string, payload: string, now: string): void {
    this.db
      .query('INSERT INTO settlements (org_id, settlement_id, op_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(orgId, settlementId, opId, payload, now)
  }

  hasSettlement(orgId: string, settlementId: string): boolean {
    const row = this.db.query('SELECT 1 FROM settlements WHERE org_id = ? AND settlement_id = ?').get(orgId, settlementId)
    return row !== null
  }

  close(): void {
    this.db.close()
  }
}
