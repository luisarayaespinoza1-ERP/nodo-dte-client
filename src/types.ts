export type DocType = 33 | 34 | 39 | 41;

export interface EmitItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface EmitPayload {
  docType: DocType;
  receptorRut?: string;
  receptorName: string;
  receptorGiro?: string;
  items: EmitItem[];
}

export interface NodoClientConfig {
  baseUrl: string;
  apiKey: string;
}

export interface DteRecord {
  id: string;
  docType: DocType;
  folio?: number;
  status: string;
  [key: string]: unknown;
}

export interface AnnulOptions {
  idempotencyKey?: string;
}
