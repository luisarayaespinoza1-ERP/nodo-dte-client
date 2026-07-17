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
