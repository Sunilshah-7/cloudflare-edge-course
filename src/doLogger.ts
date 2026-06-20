type LogLevel = 'info' | 'error';

type LogFields = Record<string, unknown>;

export function logDurableObjectEvent(
	ctx: DurableObjectState,
	doClass: string,
	event: string,
	fields: LogFields = {},
	level: LogLevel = 'info'
) {
	const entry = {
		timestamp: new Date().toISOString(),
		level,
		doClass,
		doId: ctx.id.toString(),
		event,
		...fields,
	};

	console.log(JSON.stringify(entry));
}

export function serializeError(error: unknown) {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
		};
	}

	return {
		message: String(error),
	};
}
