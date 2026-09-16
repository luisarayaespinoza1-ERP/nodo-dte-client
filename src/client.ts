import {
  ACCEPTED_STATUSES,
  ERROR_STATUSES,
  NON_FINAL_STATUSES,
  PAYMENT_FINAL_STATUSES,
  type CancelPaymentIntentResult,
  type CreatePaymentIntentPayload,
  type PaymentIntent,
  type PaymentPollOptions,
  type PaymentTerminal,
  type RefundPaymentIntentResult,
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

    /**
     * Cobros en terminales POS físicos (Mercado Pago Point, TUU…) a través del
     * hub de pagos de NODO. Scopes: `payments:write` / `payments:read` /
     * `payments:refund` (este último se pide aparte al crear la key).
     *
     * La regla que hay que entender antes de integrar: el cobro va ANTES que el
     * documento. Creá el intento, esperá APPROVED, y recién ahí emití tu boleta.
     */
    payments: {
      /**
       * Crea un cobro y lo empuja al terminal.
       *
       * `idempotencyKey` es OBLIGATORIA a propósito, y a diferencia de emit()
       * NO tiene default derivado del contenido. En pagos ese default sería un
       * bug: dos clientes que pagan lo mismo en el mismo terminal dentro de la
       * misma hora (un bidón de $2.000, un café) tendrían la misma key, y el
       * segundo recibiría el cobro del primero en vez de pagar. Pasá el id de
       * TU operación (order.id, ticket.id): un reintento con esa key devuelve
       * el mismo cobro y nunca pasa la tarjeta dos veces.
       */
      async createIntent(payload: CreatePaymentIntentPayload, idempotencyKey: string): Promise<PaymentIntent> {
        if (!idempotencyKey) {
          throw new Error("NODO payments.createIntent: idempotencyKey es obligatoria (usá el id de tu operación)");
        }
        const res = await fetch(`${base}/api/v1/payments/intents`, {
          method: "POST",
          headers: {
            ...authHeaders(config.apiKey),
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify(payload),
        });
        return parseJsonOrThrow<PaymentIntent>(res, "payments.createIntent");
      },

      /** Estado actual. NODO le pregunta al adquirente antes de responder. */
      async getIntent(id: string): Promise<PaymentIntent> {
        const res = await fetch(`${base}/api/v1/payments/intents/${id}`, {
          headers: authHeaders(config.apiKey),
        });
        return parseJsonOrThrow<PaymentIntent>(res, "payments.getIntent");
      },

      /**
       * Espera hasta un estado final respetando el ritmo que sugiere NODO
       * (`poll_after_ms`, que depende del adquirente — TUU no aguanta menos de
       * 2 s). Preferí el webhook `payment.intent_changed` si podés recibirlo:
       * esto existe para cuando no.
       *
       * Un error de red NO corta la espera: el cobro puede estar aprobándose en
       * el terminal justo en ese momento. Solo el timeout la corta.
       */
      async pollUntilFinal(id: string, opts?: PaymentPollOptions): Promise<PaymentIntent> {
        const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000;
        const minIntervalMs = opts?.minIntervalMs ?? 2000;
        const deadline = Date.now() + timeoutMs;
        let last: PaymentIntent | null = null;
        while (Date.now() < deadline) {
          try {
            last = await client.payments.getIntent(id);
            if (PAYMENT_FINAL_STATUSES.includes(last.status)) return last;
          } catch {
            // Sin señal o NODO caído un momento: se sigue esperando.
          }
          await sleep(Math.max(last?.poll_after_ms ?? 0, minIntervalMs));
        }
        if (last) return last;
        throw new Error(`NODO payments.pollUntilFinal: sin respuesta de NODO en ${timeoutMs} ms`);
      },

      /** Cancela un cobro en curso. `canceled: false` + reason "cancel_on_terminal" = hay que cancelarlo en el aparato. */
      async cancelIntent(id: string): Promise<CancelPaymentIntentResult> {
        const res = await fetch(`${base}/api/v1/payments/intents/${id}/cancel`, {
          method: "POST",
          headers: authHeaders(config.apiKey),
        });
        return parseJsonOrThrow<CancelPaymentIntentResult>(res, "payments.cancelIntent");
      },

      /**
       * Devuelve plata. Sin `amount` = total. Scope `payments:refund`.
       *
       * EJECUTA DIRECTO, sin confirmación humana. `idempotencyKey` es
       * obligatoria por el mismo motivo que en createIntent: un reintento de
       * red sin ella podría devolver DOS VECES un reembolso parcial.
       */
      async refundIntent(
        id: string,
        idempotencyKey: string,
        opts?: { amount?: number; reason?: string },
      ): Promise<RefundPaymentIntentResult> {
        if (!idempotencyKey) {
          throw new Error("NODO payments.refundIntent: idempotencyKey es obligatoria");
        }
        const res = await fetch(`${base}/api/v1/payments/intents/${id}/refund`, {
          method: "POST",
          headers: {
            ...authHeaders(config.apiKey),
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({ amount: opts?.amount, reason: opts?.reason }),
        });
        return parseJsonOrThrow<RefundPaymentIntentResult>(res, "payments.refundIntent");
      },

      /** Terminales habilitados. Filtrá `connection_mode === "cloud"` si cobrás desde un servidor. */
      async listTerminals(): Promise<PaymentTerminal[]> {
        const res = await fetch(`${base}/api/v1/payments/terminals`, {
          headers: authHeaders(config.apiKey),
        });
        const body = await parseJsonOrThrow<{ terminals: PaymentTerminal[] }>(res, "payments.listTerminals");
        return body.terminals;
      },
    },
  };

  return client;
}

export type NodoClient = ReturnType<typeof createNodoClient>;
export { ACCEPTED_STATUSES, ERROR_STATUSES, NON_FINAL_STATUSES, PAYMENT_FINAL_STATUSES };
export type { AnnulOptions, DocType, DraftResult, DteRecord, EmitItem, EmitPayload, EmitReference, EmitResult, NodoClientConfig, PollOptions } from "./types";
