import type { NotebookDocument } from './notebook';

export type AppEnv = {
	NOTEBOOK: DurableObjectNamespace<NotebookDocument>;
	SESSION_SECRET: string;
};
