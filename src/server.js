import express from "express";
import {
  simpleLogs,
  simpleLogsErrorHandler,
  flushSimpleLogs,
  serverLogger,
} from "@simplelogs/express";

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
  const key = `revenue-${Date.now()}`;
  await serverLogger.start({ key, touchpoint: "reports/revenue/query" });

  const rows = await new Promise((resolve) =>
    setTimeout(() => resolve([{ total: 4200 }]), 120),
  );

  await serverLogger.end({ key, metadata: { rowCount: rows.length } });
  res.json(rows);
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
