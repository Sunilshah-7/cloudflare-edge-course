import { DurableObject } from 'cloudflare:workers';
import { logDurableObjectEvent, serializeError } from './doLogger';

export interface UserPreference {
	key: string;
	value: string;
	updatedAt: string;
}

export class UserState extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS user_preferences (
					user_id TEXT NOT NULL,
					key TEXT NOT NULL,
					value TEXT NOT NULL,
					updated_at TEXT NOT NULL DEFAULT (datetime('now')),
					PRIMARY KEY (user_id, key)
				);
				CREATE INDEX IF NOT EXISTS idx_user_preferences_user
					ON user_preferences (user_id);
			`);
		});
	}

	async setPreference(userId: string, key: string, value: string): Promise<UserPreference> {
		const startTime = Date.now();

		try {
			const row = this.ctx.storage.sql
				.exec<{ key: string; value: string; updated_at: string }>(
					`
						INSERT INTO user_preferences (user_id, key, value, updated_at)
						VALUES (?, ?, ?, datetime('now'))
						ON CONFLICT(user_id, key) DO UPDATE SET
							value = excluded.value,
							updated_at = datetime('now')
						RETURNING key, value, updated_at
					`,
					userId,
					key,
					value
				)
				.one();

			const preference = {
				key: row.key,
				value: row.value,
				updatedAt: row.updated_at,
			};
			logDurableObjectEvent(this.ctx, 'UserState', 'user_state.set_preference', {
				userId,
				key,
				durationMs: Date.now() - startTime,
			});
			return preference;
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'UserState',
				'user_state.error',
				{
					operation: 'setPreference',
					userId,
					key,
					error: serializeError(error),
					durationMs: Date.now() - startTime,
				},
				'error'
			);
			throw error;
		}
	}

	async getPreference(userId: string, key: string): Promise<UserPreference | null> {
		const startTime = Date.now();

		try {
			const rows = this.ctx.storage.sql
				.exec<{ key: string; value: string; updated_at: string }>(
					`
						SELECT key, value, updated_at
						FROM user_preferences
						WHERE user_id = ? AND key = ?
					`,
					userId,
					key
				)
				.toArray();

			const row = rows[0];
			if (!row) {
				logDurableObjectEvent(this.ctx, 'UserState', 'user_state.get_preference', {
					userId,
					key,
					found: false,
					durationMs: Date.now() - startTime,
				});
				return null;
			}

			const preference = {
				key: row.key,
				value: row.value,
				updatedAt: row.updated_at,
			};
			logDurableObjectEvent(this.ctx, 'UserState', 'user_state.get_preference', {
				userId,
				key,
				found: true,
				durationMs: Date.now() - startTime,
			});
			return preference;
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'UserState',
				'user_state.error',
				{
					operation: 'getPreference',
					userId,
					key,
					error: serializeError(error),
					durationMs: Date.now() - startTime,
				},
				'error'
			);
			throw error;
		}
	}

	async listPreferences(userId: string): Promise<UserPreference[]> {
		const startTime = Date.now();

		try {
			const preferences = this.ctx.storage.sql
				.exec<{ key: string; value: string; updated_at: string }>(
					`
						SELECT key, value, updated_at
						FROM user_preferences
						WHERE user_id = ?
						ORDER BY key ASC
					`,
					userId
				)
				.toArray()
				.map((row) => ({
					key: row.key,
					value: row.value,
					updatedAt: row.updated_at,
				}));
			logDurableObjectEvent(this.ctx, 'UserState', 'user_state.list_preferences', {
				userId,
				count: preferences.length,
				durationMs: Date.now() - startTime,
			});
			return preferences;
		} catch (error) {
			logDurableObjectEvent(
				this.ctx,
				'UserState',
				'user_state.error',
				{
					operation: 'listPreferences',
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
