import { DurableObject } from 'cloudflare:workers';
import { logDurableObjectEvent, serializeError } from './doLogger';

export interface LedgerEntry {
	id: number;
	userId: string;
	amount: number;
	description: string | null;
	createdAt: string;
}

export class UserLedger extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS ledger (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					user_id TEXT NOT NULL,
					amount REAL NOT NULL,
					description TEXT,
					created_at TEXT NOT NULL DEFAULT (datetime('now'))
				);
				CREATE INDEX IF NOT EXISTS idx_ledger_user_created_at
					ON ledger (user_id, created_at);
			`);
		});
	}

	async add(userId: string, amount: number, description: string | null = null): Promise<LedgerEntry> {
		const startTime = Date.now();

		try {
			const row = this.ctx.storage.sql
				.exec<{
					id: number;
					user_id: string;
					amount: number;
					description: string | null;
					created_at: string;
				}>(
					`
						INSERT INTO ledger (user_id, amount, description)
						VALUES (?, ?, ?)
						RETURNING id, user_id, amount, description, created_at
					`,
					userId,
					amount,
					description
				)
				.one();

			const entry = {
				id: row.id,
				userId: row.user_id,
				amount: row.amount,
				description: row.description,
				createdAt: row.created_at,
			};
			logDurableObjectEvent(this.ctx, 'UserLedger', 'ledger.add', {
				userId,
				entryId: entry.id,
				amount,
				hasDescription: description !== null,
				durationMs: Date.now() - startTime,
			});
			return entry;
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'UserLedger',
				'ledger.error',
				{
					operation: 'add',
					userId,
					amount,
					error: serializeError(error),
					durationMs: Date.now() - startTime,
				},
				'error'
			);
			throw error;
		}
	}

	async balance(userId: string): Promise<number> {
		const startTime = Date.now();

		try {
			const row = this.ctx.storage.sql
				.exec<{ total: number | null }>(
					'SELECT SUM(amount) as total FROM ledger WHERE user_id = ?',
					userId
				)
				.one();
			const balance = row.total || 0;
			logDurableObjectEvent(this.ctx, 'UserLedger', 'ledger.balance', {
				userId,
				balance,
				durationMs: Date.now() - startTime,
			});
			return balance;
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'UserLedger',
				'ledger.error',
				{
					operation: 'balance',
					userId,
					error: serializeError(error),
					durationMs: Date.now() - startTime,
				},
				'error'
			);
			throw error;
		}
	}
}
