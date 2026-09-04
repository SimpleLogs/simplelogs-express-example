import { randomUUID } from "node:crypto";
import express from "express";
import {
  simpleLogs,
  simpleLogsErrorHandler,
  flushSimpleLogs,
  serverLogger,
} from "@simplelogs/express";
import { initOtel } from "@simplelogs/node";

const app = express();
app.use(express.json());

// --- 1. Mount before your routes -------------------------------------------
// This is half of the integration. It times every request and opens a
// per-request scope, so anything logged while a route is running is attributed
// to that request without passing `req` around.
app.use(
  simpleLogs({
    serverKey: process.env.SIMPLELOGS_SERVER_KEY,
    environment: process.env.NODE_ENV ?? "development",
    // Probes and static assets would otherwise dominate the timing data.
    ignore: ["/healthz", /^\/static\//],
  }),
);

// --- 1b. Turn tracing on ----------------------------------------------------
// The middleware above branches on whether OpenTelemetry has started. Without
// this call it takes the queue path: requests are still timed and still carry
// the caller's page and session ids, but there are no spans, so an inbound
// `traceparent` is read and dropped and the API's work sits in a tree of its
// own instead of inside the caller's.
//
// Nothing reports that. A process that never opted into tracing is not
// misconfigured, so the fallback is silent by design.
//
// After the mount, not before: `simpleLogs()` applies the config it was given,
// and `initOtel()` resolves its OTLP endpoint from the config as it stands
// when it runs.
//
// From `@simplelogs/node`, which `@simplelogs/express` does not re-export
// `initOtel` from — hence the direct dependency. It is the same version this
// package already pulls in; declaring it is what makes it resolve under a
// non-hoisted `node_modules` layout.
//
// `instrumentations: []` because the middleware continues the caller's trace
// itself. `@opentelemetry/instrumentation-http` would add the same for
// requests this middleware never sees, and is not worth the dependency here.
initOtel({ instrumentations: [] });

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// --- 2. Requests are timed for you ------------------------------------------
// No logging code in this handler. It records as `orders/[id]` — the id is
// masked, so one touchpoint covers every order rather than one per customer.
app.get("/orders/:id", (req, res) => {
  res.json({ id: req.params.id, status: "shipped" });
});

// --- 3. Add your own logs on top --------------------------------------------
// Note there is no `req` argument. The middleware already made this request's
// page and session ids ambient, so this line correlates to the browser session
// that caused it.
app.post("/checkout", async (req, res) => {
  await serverLogger.log({
    touchpoint: "checkout/submit",
    level: "info",
    message: "Checkout started",
    metadata: { itemCount: req.body?.items?.length ?? 0 },
  });

  res.json({ ok: true });
});

// --- 4. Time a sub-operation inside a request -------------------------------
// The query gets its own entry alongside the request's, so you can see how
// much of the response time it accounted for. start() and end() match on
// `key`, so operations that overlap stay separate timings.
app.get("/reports/revenue", async (_req, res) => {
  // randomUUID, not Date.now(): start/end are matched through a map on a
  // process-wide queue, so two requests in the same millisecond would share a
  // timestamp key and cross each other's pairs.
  const key = `revenue-${randomUUID()}`;
  await serverLogger.start({ key, touchpoint: "reports/revenue/query" });

  try {
    const rows = await new Promise((resolve) =>
      setTimeout(() => resolve([{ total: 4200 }]), 120),
    );
    res.json(rows);
  } finally {
    // In a finally: a query that throws is the one most worth timing, and a
    // start that never closes records nothing at all.
    await serverLogger.end({ key });
  }
});

// --- 5. Errors ---------------------------------------------------------------
app.get("/boom", () => {
  throw new Error("Something broke in the example");
});

// The other half of the integration. It goes after your routes, and it logs
// and re-raises — your own error handling still runs exactly as before.
app.use(simpleLogsErrorHandler());

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err.message });
});

const port = process.env.PORT ?? 3100;
const server = app.listen(port, () => {
  console.log(`Example API on http://localhost:${port}`);
});

// Entries are batched, so a process that exits mid-batch drops them. The SDK
// flushes on `beforeExit` by itself, but a container killed with SIGTERM never
// reaches that — hence the explicit flush.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(async () => {
      await flushSimpleLogs();
      process.exit(0);
    });
  });
}
