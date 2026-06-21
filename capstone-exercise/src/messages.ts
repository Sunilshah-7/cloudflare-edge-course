export type Role = 'owner' | 'editor' | 'viewer';

export type Selection = {
	anchor: number;
	head: number;
};

export type ActiveUser = {
	id: string;
	name: string;
	role: Role;
	pos: number | null;
	selection: Selection | null;
};

export type ClientMessage =
	| {
			type: 'edit';
			update?: string;
			content?: string;
			clientSeq?: number;
			clientTs?: number;
	  }
	| { type: 'cursor'; pos: number; selection?: Selection | null }
	| { type: 'ping'; clientTs?: number };

export type ServerMessage =
	| {
			type: 'init';
			content: string;
			snapshot: string;
			revision: number;
			users: ActiveUser[];
	  }
	| {
			type: 'update';
			content: string;
			update: string;
			from: string;
			revision: number;
	  }
	| { type: 'cursor'; userId: string; pos: number; selection: Selection | null }
	| { type: 'users'; active: ActiveUser[] }
	| { type: 'ack'; clientSeq?: number; revision: number; serverTs: number; clientTs?: number }
	| { type: 'pong'; serverTs: number; clientTs?: number }
	| { type: 'error'; code: string; message: string };

export type ConnectionAttachment = {
	docId: string;
	userId: string;
	name: string;
	role: Role;
	cursor: number | null;
	selection: Selection | null;
	connectedAt: number;
};

export function isRole(value: string): value is Role {
	return value === 'owner' || value === 'editor' || value === 'viewer';
}

export function canEdit(role: Role): boolean {
	return role === 'owner' || role === 'editor';
}
