/** Tipos del cliente de NODO v1. Reflejan el emitSchema real del ERP. */

// Tipos de documento que la API v1 acepta hoy.
export type DocType = 33 | 34 | 39 | 41 | 56 | 61;

export interface EmitItem {
  name: string;
  description?: string;
  quantity: number;
  /** Default 'UN' en el ERP si se omite. */
  unit?: string;
  unitPrice: number;
  /** 0-100. */
  discountPercent?: number;
  /** true = línea exenta de IVA (boleta/factura exenta). */
  isExempt?: boolean;
}

/** Referencia a otro documento — obligatoria en notas de crédito/débito (56/61). */
export interface EmitReference {
  refDocType: number | string;
  refFolio?: string;
  refReason?: string;
  /** 1=anula, 2=corrige texto, 3=corrige montos. */
  refCode?: "1" | "2" | "3";
}

export interface EmitPayload {
  docType: DocType;
  /** ISO yyyy-mm-dd; default hoy en el ERP. */
  issueDate?: string;
  receptorRut?: string;
  receptorName: string;
  receptorGiro?: string;
  receptorAddress?: string;
  receptorCity?: string;
  receptorEmail?: string;
  /** 1=contado, 2=crédito, 3=sin costo. */
  fmaPago?: 1 | 2 | 3;
  items: EmitItem[];
  references?: EmitReference[];
}

export interface NodoClientConfig {
  baseUrl: string;
  apiKey: string;
}

/** Respuesta de POST /api/v1/dte/emit — el DTE se emite async (status inicial
 *  suele ser PENDING; usar pollUntilFinal(dteId) para el estado final). */
export interface EmitResult {
  success: boolean;
  dteId: string;
  status: string;
}

/** Respuesta de GET /api/v1/dte/:id — snake_case, como lo devuelve el ERP. */
export interface DteRecord {
  id: string;
  doc_type: number;
  folio?: number;
  /** DRAFT | PENDING | SENT | ACCEPTED | ACCEPTED_WITH_DISCREPANCIES | REJECTED | CANCELLED */
  status: string;
  sii_status?: string | null;
  sii_estado_dte?: string | null;
  total?: number;
  issue_date?: string;
  payment_status?: string | null;
  items?: unknown[];
  references?: unknown[];
  [key: string]: unknown;
}

/** Respuesta de POST /api/v1/dte/draft — crea un borrador para revisión humana. */
export interface DraftResult {
  draft_id: string;
  review_url: string;
}

export interface AnnulOptions {
  idempotencyKey?: string;
}

/** Estados de NODO que aún no son finales — hay que seguir haciendo polling. */
export const NON_FINAL_STATUSES: readonly string[] = ["DRAFT", "PENDING", "SENT"];
/** Estados finales de error — el DTE no quedó aceptado. */
export const ERROR_STATUSES: readonly string[] = ["REJECTED", "CANCELLED", "ANULADO"];
/** Estados finales de éxito. */
export const ACCEPTED_STATUSES: readonly string[] = ["ACCEPTED", "ACCEPTED_WITH_DISCREPANCIES"];

export interface PollOptions {
  /** Intentos máximos (default 10). */
  attempts?: number;
  /** Espera entre intentos en ms (default 3000). */
  intervalMs?: number;
}

// ---------------------------------------------------------------------------
// Pagos con terminal POS (hub de pagos de NODO, Fase E)
// ---------------------------------------------------------------------------

/** Adquirentes que soporta el hub. */
export type PaymentProvider = "mercadopago_point" | "transbank_pos" | "tuu" | "getnet_pos" | "klap";

/**
 * `cloud`: NODO le habla al adquirente por internet — se puede cobrar desde
 * esta API. `browser`: el terminal va por cable al computador de la caja
 * (Transbank) — NO se puede cobrar desde un servidor; filtralo si tu
 * integración es de backend.
 */
export type PaymentConnectionMode = "cloud" | "browser";

export type PaymentIntentStatus =
  | "CREATED"
  | "SENT_TO_TERMINAL"
  | "PROCESSING"
  | "APPROVED"
  | "DECLINED"
  | "CANCELED"
  | "EXPIRED"
  | "ERROR"
  | "REFUNDED";

/** Estados después de los cuales ya no hay nada que esperar. */
export const PAYMENT_FINAL_STATUSES: readonly PaymentIntentStatus[] = [
  "APPROVED",
  "DECLINED",
  "CANCELED",
  "EXPIRED",
  "ERROR",
  "REFUNDED",
];

export interface CreatePaymentIntentPayload {
  /** El serial que trae el aparato. Alternativa: `terminal_id` (el uuid de NODO). */
  terminal_external_id?: string;
  terminal_id?: string;
  /** Pesos ENTEROS. */
  amount: number;
  /** Default "external". */
  source_type?: "external" | "dte" | "web_order" | "proposal";
  /** Tu id de la operación — vuelve intacto en el webhook `payment.intent_changed`. */
  source_id?: string;
  description?: string;
  installments?: number;
}

/** Un cobro, tal como lo devuelve la API v1 (snake_case). */
export interface PaymentIntent {
  id: string;
  status: PaymentIntentStatus;
  amount: number;
  currency: string;
  provider: PaymentProvider;
  connection_mode: PaymentConnectionMode;
  terminal_id: string | null;
  source_type: string | null;
  source_id: string | null;
  external_reference: string;
  authorization_code: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_type: string | null;
  installments: number | null;
  /** "browser" = lo informó el navegador de la caja, no el adquirente. La cartola es la verdad final. */
  attested_by: "provider" | "browser";
  refund_amount: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** Cuánto esperar antes de volver a consultar. null = ya no hay nada que esperar. */
  poll_after_ms?: number | null;
  [key: string]: unknown;
}

export interface CancelPaymentIntentResult extends PaymentIntent {
  canceled: boolean;
  /** "cancel_on_terminal": el cobro ya llegó al aparato y solo se cancela ahí. */
  reason: string | null;
}

export interface RefundPaymentIntentResult extends PaymentIntent {
  refunded: number;
}

export interface PaymentTerminal {
  id: string;
  name: string;
  provider: PaymentProvider;
  connection_mode: PaymentConnectionMode;
  external_id: string | null;
  branch_id: string | null;
  last_seen_at: string | null;
}

export interface PaymentPollOptions {
  /** Tope total de espera en ms (default 10 min — lo mismo que vive un cobro en NODO). */
  timeoutMs?: number;
  /** Espera mínima entre consultas si el servidor no sugiere una (default 2000). */
  minIntervalMs?: number;
}
