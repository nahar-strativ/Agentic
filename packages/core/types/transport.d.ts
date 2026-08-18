import type { Annotation, PageContext, Status } from './index.js';

export type SyncState = 'offline' | 'connecting' | 'connected' | 'error';

export interface BrokerEvent {
  type: string;
  data: any;
}

export interface Transport {
  getState(): SyncState;
  /** Probes `/health`, then opens the event stream. Retries with backoff. */
  connect(): Promise<boolean>;
  list(): Promise<{ annotations: Annotation[]; cursor: number }>;
  registerSession(page: PageContext): Promise<unknown>;
  push(annotations: Annotation[], page: PageContext): Promise<unknown>;
  patch(id: string, changes: Partial<Annotation>): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  /**
   * Answering the agent also moves the annotation off `needs-input` — leaving it
   * would keep the agent believing it is still blocked.
   */
  reply(id: string, message: string, status?: Status): Promise<unknown>;
  destroy(): void;
}

export function createTransport(options: {
  endpoint: string;
  sessionId: string;
  onState: (state: SyncState) => void;
  onEvent: (event: BrokerEvent) => void;
}): Transport;
