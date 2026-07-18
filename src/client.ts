import {
  ACCEPTED_STATUSES,
  ERROR_STATUSES,
  NON_FINAL_STATUSES,
  type AnnulOptions,
  type DocType,
  type DraftResult,
  type DteRecord,
  type EmitPayload,
  type EmitResult,
  type NodoClientConfig,
  type PollOptions,
} from "./types";
import { defaultIdempotencyKey } from "./idempotency";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createNodoClient(config: NodoClientConfig) {
  const base = config.baseUrl.replace(/\/$/, "");

  const client = {
    /** GET /api/v1/dte/ping — el ERP responde 404 cuando la key es valida (no hay endpoint real, solo valida auth) */
    async ping(): Promise<{ ok: boolean; status: number }> {
      const res = await fetch(`${base}/api/v1/dte/ping`, {
        headers: authHeaders(config.apiKey),
      });
      return { ok: res.status === 404, status: res.status };
    },

    /** Emite un DTE. NODO es asíncrono: la respuesta suele venir en PENDING/SENT
     *  — usar pollUntilFinal(id) para esperar el estado final del SII.
     *  Si no pasas idempotencyKey, se deriva una determinística del payload
     *  (mismo contenido → misma key), así un retry nunca duplica la emisión. */
    async emit(payload: EmitPayload, idempotencyKey?: string): Promise<EmitResult> {
      const headers: Record<string, string> = {
        ...authHeaders(config.apiKey),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey ?? defaultIdempotencyKey("emit", payload),
      };
      const res = await fetch(`${base}/api/v1/dte/emit`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      return parseJsonOrThrow<EmitResult>(res, "emit");
    },

    /** Crea un BORRADOR (requiere scope dte:draft) — un humano lo confirma en la app.
     *  Mismo default de idempotencyKey que emit(). */
    async draft(payload: EmitPayload, idempotencyKey?: string): Promise<DraftResult> {
      const headers: Record<string, string> = {
        ...authHeaders(config.apiKey),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey ?? defaultIdempotencyKey("draft", payload),
      };
      const res = await fetch(`${base}/api/v1/dte/draft`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      return parseJsonOrThrow<DraftResult>(res, "draft");
    },

    async get(id: string): Promise<DteRecord> {
      const res = await fetch(`${base}/api/v1/dte/${id}`, {
        headers: authHeaders(config.apiKey),
      });
      return parseJsonOrThrow<DteRecord>(res, "get");
    },

    /** Hace polling de get(id) hasta que el DTE llega a un estado final del SII
     *  (aceptado o error). Devuelve el último DteRecord — el caller revisa
     *  .status. Estandariza el polling que antes cada app reimplementaba. */
    async pollUntilFinal(id: string, opts?: PollOptions): Promise<DteRecord> {
      const attempts = opts?.attempts ?? 10;
      const intervalMs = opts?.intervalMs ?? 3000;
      let last: DteRecord = await client.get(id);
      for (let i = 0; i < attempts; i++) {
        if (!NON_FINAL_STATUSES.includes(last.status)) return last;
        await sleep(intervalMs);
        last = await client.get(id);
      }
      return last;
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

    /** Anula un DTE. Sin idempotencyKey explícita, usa el propio id como key
     *  por defecto — a diferencia de emit()/draft(), anular el mismo id dos
     *  veces siempre debe ser la misma operación (no hace falta bucket
     *  horario: no existe un "anular esto de nuevo, pero distinto"). */
    async annul(id: string, opts?: AnnulOptions): Promise<DteRecord> {
      const headers: Record<string, string> = {
        ...authHeaders(config.apiKey),
        "Idempotency-Key": opts?.idempotencyKey ?? `annul:${id}`,
      };
      const res = await fetch(`${base}/api/v1/dte/${id}/annul`, {
        method: "POST",
        headers,
      });
      return parseJsonOrThrow<DteRecord>(res, "annul");
    },
  };

  return client;
}

export type NodoClient = ReturnType<typeof createNodoClient>;
export { ACCEPTED_STATUSES, ERROR_STATUSES, NON_FINAL_STATUSES };
export type { AnnulOptions, DocType, DraftResult, DteRecord, EmitItem, EmitPayload, EmitReference, EmitResult, NodoClientConfig, PollOptions } from "./types";
