import type { AnnulOptions, DocType, DteRecord, EmitPayload, NodoClientConfig } from "./types";

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

async function parseJsonOrThrow<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NODO ${action} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export function createNodoClient(config: NodoClientConfig) {
  const base = config.baseUrl.replace(/\/$/, "");

  return {
    /** GET /api/v1/dte/ping — el ERP responde 404 cuando la key es valida (no hay endpoint real, solo valida auth) */
    async ping(): Promise<{ ok: boolean; status: number }> {
      const res = await fetch(`${base}/api/v1/dte/ping`, {
        headers: authHeaders(config.apiKey),
      });
      return { ok: res.status === 404, status: res.status };
    },

    async emit(payload: EmitPayload, idempotencyKey?: string): Promise<DteRecord> {
      const headers: Record<string, string> = {
        ...authHeaders(config.apiKey),
        "Content-Type": "application/json",
      };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const res = await fetch(`${base}/api/v1/dte/emit`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      return parseJsonOrThrow<DteRecord>(res, "emit");
    },

    async get(id: string): Promise<DteRecord> {
      const res = await fetch(`${base}/api/v1/dte/${id}`, {
        headers: authHeaders(config.apiKey),
      });
      return parseJsonOrThrow<DteRecord>(res, "get");
    },

    /** Devuelve la Response cruda (stream) para reenviarla desde un route handler sin bufferear en memoria */
    async pdf(id: string): Promise<Response> {
      const res = await fetch(`${base}/api/v1/dte/${id}/pdf`, {
        headers: authHeaders(config.apiKey),
      });
      if (!res.ok) throw new Error(`NODO pdf failed: ${res.status}`);
      return res;
    },

    async xml(id: string): Promise<Response> {
      const res = await fetch(`${base}/api/v1/dte/${id}/xml`, {
        headers: authHeaders(config.apiKey),
      });
      if (!res.ok) throw new Error(`NODO xml failed: ${res.status}`);
      return res;
    },

    async annul(id: string, opts?: AnnulOptions): Promise<DteRecord> {
      const headers: Record<string, string> = { ...authHeaders(config.apiKey) };
      if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
      const res = await fetch(`${base}/api/v1/dte/${id}/annul`, {
        method: "POST",
        headers,
      });
      return parseJsonOrThrow<DteRecord>(res, "annul");
    },
  };
}

export type NodoClient = ReturnType<typeof createNodoClient>;
export type { DocType, DteRecord, EmitItem, EmitPayload, NodoClientConfig } from "./types";
