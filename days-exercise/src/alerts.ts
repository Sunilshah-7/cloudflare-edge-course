export type AlertSeverity = 'info' | 'warning' | 'critical';

interface SlackAttachment {
	color: 'good' | 'warning' | 'danger';
	text: string;
	footer: string;
	ts: number;
}

interface SlackPayload {
	attachments: SlackAttachment[];
}

function getSlackColor(severity: AlertSeverity): SlackAttachment['color'] {
	if (severity === 'critical') {
		return 'danger';
	}

	if (severity === 'warning') {
		return 'warning';
	}

	return 'good';
}

export async function sendAlert(
	env: Env,
	message: string,
	severity: AlertSeverity = 'warning'
): Promise<void> {
	if (!env.SLACK_WEBHOOK_URL) {
		return;
	}

	const payload: SlackPayload = {
		attachments: [
			{
				color: getSlackColor(severity),
				text: message,
				footer: 'Cloudflare Worker',
				ts: Math.floor(Date.now() / 1000),
			},
		],
	};

	const response = await fetch(env.SLACK_WEBHOOK_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		throw new Error(`Slack alert failed: ${response.status}`);
	}
}
