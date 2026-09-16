import test from "node:test";
import assert from "node:assert/strict";
import { createNodoClient } from "./client";

type Call = { url: string; init: RequestInit };

/** Reemplaza fetch global por uno falso que devuelve las respuestas en orden (o lanza si la entrada es un Error). */
function fakeFetch(responses: ({ status: number; body: unknown } | Error)[]) {
  const calls: Call[] = [];
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const client = createNodoClient({ baseUrl: "https://nodo.test/", apiKey: "jbx_live_test" });
const intent = (status: string, extra: Record<string, unknown> = {}) => ({
  success: true, id: "int-1", status, amount: 2000, poll_after_ms: 1, ...extra,
});

test("createIntent manda la Idempotency-Key tal cual y el payload como JSON", async () => {
  const f = fakeFetch([{ status: 201, body: intent("SENT_TO_TERMINAL") }]);
  try {
    const res = await client.payments.createIntent({ terminal_external_id: "NEWLAND_A", amount: 2000, source_id: "orden-9" }, "orden-9");
    assert.equal(res.status, "SENT_TO_TERMINAL");
    assert.equal(f.calls[0].url, "https://nodo.test/api/v1/payments/intents");
    const headers = f.calls[0].init.headers as Record<string, string>;
    assert.equal(headers["Idempotency-Key"], "orden-9");
    assert.equal(headers.Authorization, "Bearer jbx_live_test");
    assert.equal(JSON.parse(f.calls[0].init.body as string).amount, 2000);
  } finally { f.restore(); }
});

test("createIntent SIN key falla antes de tocar la red (en pagos no hay default por contenido)", async () => {
  // Un hash del contenido haría que dos clientes que pagan $2.000 en el mismo
  // terminal compartan key: el segundo no pagaría.
  const f = fakeFetch([{ status: 201, body: intent("SENT_TO_TERMINAL") }]);
  try {
    await assert.rejects(() => client.payments.createIntent({ amount: 2000 }, ""), /obligatoria/);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test("refundIntent SIN key falla antes de tocar la red (un reintento no puede devolver dos veces)", async () => {
  const f = fakeFetch([{ status: 200, body: intent("REFUNDED") }]);
  try {
    await assert.rejects(() => client.payments.refundIntent("int-1", ""), /obligatoria/);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test("pollUntilFinal espera hasta un estado final y devuelve ese", async () => {
  const f = fakeFetch([
    { status: 200, body: intent("SENT_TO_TERMINAL") },
    { status: 200, body: intent("PROCESSING") },
    { status: 200, body: intent("APPROVED", { authorization_code: "123456" }) },
  ]);
  try {
    const res = await client.payments.pollUntilFinal("int-1", { minIntervalMs: 1 });
    assert.equal(res.status, "APPROVED");
    assert.equal(res.authorization_code, "123456");
    assert.equal(f.calls.length, 3);
  } finally { f.restore(); }
});

test("pollUntilFinal NO se corta por un error de red: el cobro puede estar aprobándose", async () => {
  const f = fakeFetch([
    new Error("ECONNRESET"),
    new Error("ECONNRESET"),
    { status: 200, body: intent("APPROVED") },
  ]);
  try {
    const res = await client.payments.pollUntilFinal("int-1", { minIntervalMs: 1 });
    assert.equal(res.status, "APPROVED");
  } finally { f.restore(); }
});

test("pollUntilFinal respeta el timeout y devuelve el último estado conocido", async () => {
  const f = fakeFetch([{ status: 200, body: intent("SENT_TO_TERMINAL") }]);
  try {
    const res = await client.payments.pollUntilFinal("int-1", { timeoutMs: 30, minIntervalMs: 5 });
    assert.equal(res.status, "SENT_TO_TERMINAL");
  } finally { f.restore(); }
});

test("un error HTTP se propaga con el status y el cuerpo (como el resto del SDK)", async () => {
  const f = fakeFetch([{ status: 403, body: { error: { code: "insufficient_scope" } } }]);
  try {
    await assert.rejects(() => client.payments.getIntent("int-1"), /403.*insufficient_scope/);
  } finally { f.restore(); }
});

test("listTerminals desenvuelve la lista", async () => {
  const f = fakeFetch([{ status: 200, body: { success: true, terminals: [{ id: "t-1", connection_mode: "cloud" }] } }]);
  try {
    const terminals = await client.payments.listTerminals();
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].id, "t-1");
  } finally { f.restore(); }
});
