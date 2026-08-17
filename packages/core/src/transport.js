/**
 * Optional sync channel to the local earmark dev server.
 *
 * Absent a reachable server the overlay stays fully functional in copy-paste
 * mode, so every failure here degrades quietly rather than throwing into the
 * host app's console.
 */

/**
 * @typedef {'offline' | 'connecting' | 'connected' | 'error'} SyncState
 */

/**
 * @param {object} options
 * @param {string} options.endpoint base URL of the dev server
 * @param {string} options.sessionId
 * @param {(state: SyncState) => void} options.onState
 * @param {(event: {type: string, data: any}) => void} options.onEvent
 */
export function createTransport({ endpoint, sessionId, onState, onEvent }) {
  const base = endpoint.replace(/\/$/, '');
  /** @type {EventSource | null} */
  let source = null;
  /** @type {SyncState} */
  let state = 'offline';
  let retryDelay = 1000;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let retryTimer = null;
  let destroyed = false;

  /** @param {SyncState} next */
  function setState(next) {
    if (state === next) return;
    state = next;
    onState(next);
  }

  /**
   * @param {string} path
   * @param {RequestInit} [init]
   */
  async function request(path, init = {}) {
    const response = await fetch(base + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    });
    if (!response.ok) {
      throw new Error(`earmark: ${init.method || 'GET'} ${path} → ${response.status}`);
    }
    return response.status === 204 ? null : response.json();
  }

  function openStream() {
    if (destroyed || source) return;
    setState('connecting');
    try {
      source = new EventSource(`${base}/events?session=${encodeURIComponent(sessionId)}`);
    } catch {
      setState('error');
      return;
    }

    source.onopen = () => {
      retryDelay = 1000;
      setState('connected');
    };

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        onEvent(payload);
      } catch {
        /* malformed frame — ignore */
      }
    };

    source.onerror = () => {
      source?.close();
      source = null;
      if (destroyed) return;
      setState('error');
      // Exponential backoff capped at 30s so a stopped server does not spin.
      retryTimer = setTimeout(openStream, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    };
  }

  return {
    getState: () => state,

    /** Probe the server, then open the event stream if it answers. */
    async connect() {
      try {
        await request('/health');
        openStream();
        return true;
      } catch {
        setState('offline');
        retryTimer = setTimeout(() => {
          if (!destroyed) this.connect();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
        return false;
      }
    },

    /** @returns {Promise<{annotations: object[], cursor: number}>} */
    async list() {
      return request('/annotations');
    },

    /**
     * @param {object[]} annotations
     * @param {object} page
     */
    async push(annotations, page) {
      return request('/annotations', {
        method: 'POST',
        body: JSON.stringify({ sessionId, page, annotations }),
      });
    },

    /**
     * @param {string} id
     * @param {object} changes
     */
    async patch(id, changes) {
      return request(`/annotations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
    },

    /** @param {string} id */
    async remove(id) {
      return request(`/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    /**
     * Answering the agent must also move the annotation off `needs-input` on the
     * server, or the agent keeps believing it is still blocked on a reply.
     *
     * @param {string} id
     * @param {string} message
     * @param {string} [status]
     */
    async reply(id, message, status = 'open') {
      return request(`/annotations/${encodeURIComponent(id)}/replies`, {
        method: 'POST',
        body: JSON.stringify({ author: 'human', message, status }),
      });
    },

    destroy() {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
      source = null;
      setState('offline');
    },
  };
}
