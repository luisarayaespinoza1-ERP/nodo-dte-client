# @jabex/nodo-dte-client

Cliente compartido para hablar con la API v1 de **NODO** (ERP JABEX, facturación DTE) desde apps Next.js que actúan como tenants: Portería (estacionamientos), MiPicada, Lawen, Raudo.

## Por qué existe

Cada app reimplementaba a mano el fetch a `/api/v1/dte/*` con `ERP_API_KEY`. Eso ya causó desincronía de URL/key en Portería (ver historial). Este paquete centraliza los llamados y el patrón de proxy server-side para que la API key nunca llegue al navegador.

## Instalación

En el `package.json` de la app consumidora:

```json
"dependencies": {
  "@jabex/nodo-dte-client": "github:luisarayaespinoza1-ERP/nodo-dte-client#main"
}
```

El paquete **no compila a JS** — exporta TypeScript directo (patrón "internal package" sin paso de build). Cada app lo transpila con su propio Next build agregando esto a `next.config.ts`:

```ts
const nextConfig = {
  transpilePackages: ["@jabex/nodo-dte-client"],
};
```

## Uso

### Cliente directo (emitir, consultar estado)

```ts
import { createNodoClient } from "@jabex/nodo-dte-client";

const nodo = createNodoClient({
  baseUrl: process.env.ERP_BASE_URL!,
  apiKey: process.env.ERP_API_KEY!,
});

// NODO es asíncrono: emit() suele devolver PENDING/SENT.
const dte = await nodo.emit(
  {
    docType: 39, // boleta; 33 factura, 61 NC (con references)
    receptorName: "Cliente Anónimo",
    items: [{ name: "Servicio", quantity: 1, unitPrice: 10000 }], // isExempt?, discountPercent?
  },
  crypto.randomUUID(), // Idempotency-Key: evita doble emisión ante reintentos
);

// Esperar el estado final del SII (aceptado/rechazado) sin reinventar el polling:
const final = await nodo.pollUntilFinal(dte.id); // { status: 'ACCEPTED', folio, ... }
```

Métodos: `emit`, `draft` (scope `dte:draft`), `get`, `pollUntilFinal`, `pdf`, `xml`, `annul`, `ping`.
Constantes de estado exportadas: `ACCEPTED_STATUSES`, `NON_FINAL_STATUSES`, `ERROR_STATUSES`.

### Proxy de PDF/XML/anulación en un route handler (App Router)

```ts
// src/app/api/dte/[id]/pdf/route.ts
import { proxyDtePdf } from "@jabex/nodo-dte-client/next";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyDtePdf(
    { baseUrl: process.env.ERP_BASE_URL!, apiKey: process.env.ERP_API_KEY! },
    id,
  );
}
```

Mismo patrón para `proxyDteXml` y `proxyDteAnnul` (este último acepta un tercer argumento `idempotencyKey` opcional).

### Cobrar en un terminal POS (Mercado Pago Point, TUU…)

```ts
const nodo = createNodoClient({ baseUrl: process.env.ERP_BASE_URL!, apiKey: process.env.ERP_API_KEY! });

// La key es OBLIGATORIA y tiene que ser el id de TU operación.
const intento = await nodo.payments.createIntent(
  { terminal_external_id: "NEWLAND_N950__...", amount: 24990, source_id: orden.id },
  `orden:${orden.id}`,
);
const final = await nodo.payments.pollUntilFinal(intento.id);
if (final.status === "APPROVED") {
  // recién acá se emite la boleta / se cierra el pedido
}
```

**El cobro va antes que el documento.** Emitir la boleta contra un cobro que termina rechazado no tiene arreglo automático.

**Por qué la key es obligatoria (y distinta de `emit()`):** en DTE la key por defecto se deriva del contenido. En pagos eso sería un bug — dos clientes que pagan lo mismo en el mismo terminal dentro de la misma hora compartirían key, y el segundo recibiría el cobro del primero en vez de pagar. Con el id de tu operación, un reintento de red devuelve el mismo cobro y nunca pasa la tarjeta dos veces.

**Preferí el webhook** `payment.intent_changed` al polling si podés recibir un POST. `pollUntilFinal` no se corta por errores de red (el cobro puede estar aprobándose) y respeta el ritmo que sugiere NODO por adquirente.

Scopes de la API key: `payments:write` (cobrar/cancelar), `payments:read` (consultar), `payments:refund` (devolver — se pide aparte). La empresa además tiene que tener el módulo `pagos`.

`listTerminals()` incluye terminales `connection_mode: "browser"` (Transbank por cable a la caja): **no se puede cobrar en ellos desde un servidor**. Filtralos.

Contrato completo: `ERP_API_CONTRACT.md` → "Fase E" en el repo del ERP.

## Env vars requeridas en cada app consumidora

- `ERP_BASE_URL`
- `ERP_API_KEY`

## Versionado

Sin build ni publish a un registry — se fija por commit/tag de git en cada consumidor (`#main`, `#v0.1.0`, o un sha puntual). Bump manual en cada `package.json` cuando se quiera adoptar un cambio. Si un cambio no es retrocompatible, cortar un tag nuevo y dejar los consumidores viejos apuntando al sha anterior hasta que se migren a propósito.
