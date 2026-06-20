import { DurableObject } from 'cloudflare:workers';

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

		return {
			id: row.id,
			userId: row.user_id,
			amount: row.amount,
			description: row.description,
			createdAt: row.created_at,
		};
	}

	async balance(userId: string): Promise<number> {
		const row = this.ctx.storage.sql
			.exec<{ total: number | null }>(
				'SELECT SUM(amount) as total FROM ledger WHERE user_id = ?',
				userId
			)
			.one();
		return row.total || 0;
	}
}
