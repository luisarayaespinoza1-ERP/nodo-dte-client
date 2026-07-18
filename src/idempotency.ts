import { createHash } from "node:crypto";

/** Recorre el objeto y ordena las keys para que el mismo contenido lógico
 *  produzca siempre el mismo JSON, sin importar el orden en que cada
 *  consumidor construyó el objeto. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Tamaño del bucket horario que acota la key por defecto. Cubre el peor caso
 *  de reintentos con backoff de un worker (ej. Raudo: 1+2+4+8+16 min ≈ 31 min)
 *  con margen, sin fusionar operaciones distintas que caigan fuera de la
 *  ventana. Inyectable solo para tests. */
const DEFAULT_BUCKET_MS = 60 * 60 * 1000;

/**
 * Idempotency-key determinística por defecto para cuando el caller no pasa
 * una explícita: mismo payload dentro de la misma hora → misma key, así un
 * retry automático (worker/outbox/cron) nunca duplica la operación aunque el
 * integrador se haya olvidado de derivar un id estable.
 *
 * Ojo: esto es una red de seguridad, no un reemplazo de una key propia. Si el
 * caller tiene un id estable de su propia operación (ej. order.id), debe
 * seguir pasándolo explícito — un hash de contenido sin ese id fusionaría
 * como "la misma operación" dos DTEs legítimos y distintos si tuvieran
 * exactamente el mismo payload dentro de la misma hora (ej. mismo cliente
 * compra lo mismo dos veces). El bucket horario acota ese riesgo a la
 * ventana real de reintentos en vez de fusionarlos para siempre.
 *
 * Ver incidente 2026-07-18: Raudo y MiPicada reintentaban emit() sin
 * Idempotency-Key, duplicando DTEs si el fetch se cortaba después de que
 * NODO ya había creado el documento. El bug era de cómo cada consumidor
 * LLAMABA al SDK, no del SDK — este default lo vuelve imposible por diseño
 * para quien no pase una key propia.
 */
export function defaultIdempotencyKey(
  prefix: string,
  payload: unknown,
  bucketMs: number = DEFAULT_BUCKET_MS,
): string {
  const bucket = Math.floor(Date.now() / bucketMs);
  const canonical = JSON.stringify(canonicalize(payload));
  const hash = createHash("sha256").update(`${bucket}:${canonical}`).digest("hex");
  return `${prefix}:${hash}`;
}
