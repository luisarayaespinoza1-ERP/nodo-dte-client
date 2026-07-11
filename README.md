# @jabex/nodo-dte-client

Cliente compartido para hablar con la API v1 de **NODO** (ERP JABEX, facturación DTE) desde apps Next.js que actúan como tenants: Portería (estacionamientos), MiPicada, Lawen, Raudo.

## Por qué existe

Cada app reimplementaba a mano el fetch a `/api/v1/dte/*` con `ERP_API_KEY`. Eso ya causó desincronía de URL/key en Portería (ver historial). Este paquete centraliza los llamados y el patrón de proxy server-side para que la API key nunca llegue al navegador.

## Instalación

En el `package.json` de la app consumidora:

```json
"dependencies": {
  "@jabex/nodo-dte-client": "github:syga-tic/nodo-dte-client#main"
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

const dte = await nodo.emit({
  docType: 39,
  receptorName: "Cliente Anónimo",
  items: [{ name: "Servicio", quantity: 1, unitPrice: 10000 }],
});

const estado = await nodo.get(dte.id);
```

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

## Env vars requeridas en cada app consumidora

- `ERP_BASE_URL`
- `ERP_API_KEY`

## Versionado

Sin build ni publish a un registry — se fija por commit/tag de git en cada consumidor (`#main`, `#v0.1.0`, o un sha puntual). Bump manual en cada `package.json` cuando se quiera adoptar un cambio. Si un cambio no es retrocompatible, cortar un tag nuevo y dejar los consumidores viejos apuntando al sha anterior hasta que se migren a propósito.
