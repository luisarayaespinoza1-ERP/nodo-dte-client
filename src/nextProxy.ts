import { createNodoClient } from "./client";
import type { NodoClientConfig } from "./types";

function streamFile(upstream: Response, filename: string, contentType: string): Response {
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}

/** Para usar directo en un route handler: `export async function GET() { return proxyDtePdf(config, id) }` */
export async function proxyDtePdf(config: NodoClientConfig, id: string): Promise<Response> {
  try {
    const upstream = await createNodoClient(config).pdf(id);
    return streamFile(upstream, `dte-${id}.pdf`, "application/pdf");
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function proxyDteXml(config: NodoClientConfig, id: string): Promise<Response> {
  try {
    const upstream = await createNodoClient(config).xml(id);
    return streamFile(upstream, `dte-${id}.xml`, "application/xml");
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function proxyDteAnnul(
  config: NodoClientConfig,
  id: string,
  idempotencyKey?: string,
): Promise<Response> {
  try {
    const record = await createNodoClient(config).annul(id, { idempotencyKey });
    return Response.json(record);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
