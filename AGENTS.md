# Working in simplelogs-express-example

This repo demonstrates the `@simplelogs/express` middleware in an Express API.
The whole app is [`src/server.js`](src/server.js): `simpleLogs()` mounted
before the routes, `simpleLogsErrorHandler()` after them, and `initOtel()` from
`@simplelogs/node` to turn tracing on.

## House style

Each app-facing SDK package has one standalone example repo: vanilla
(`@simplelogs/browser`, port 5173), react (`@simplelogs/react`, 5174), next
(`@simplelogs/next`, 5175), express (`@simplelogs/express`, 3100) and node
(`@simplelogs/node`, 3200). The five share one style, so keep it:

- npm, not pnpm.
- Plain JS: no TypeScript, Tailwind or ESLint.
- Node's `--env-file-if-exists` loads `.env` (see the `start` and `dev`
  scripts in `package.json`). Don't add `dotenv`.
- A `.env.example` documents the SimpleLogs variables.
- The README covers setup, key handling and the reasoning behind both, and
  closes with an "Other examples" section holding a cross-link table to the
  other examples.

## Dependencies

- Never use a `file:` or absolute-path dependency.
- Point `@simplelogs/*` ranges (currently `^2.1.0`) only at versions npm
  publishes. Check with
  `npm view @simplelogs/express versions` and
  `npm view @simplelogs/node versions`.
- `@simplelogs/node` is a direct dependency because `@simplelogs/express`
  does not re-export `initOtel`. Keep both packages on the same version.

## Environment variables

The app's own code reads:

| Variable | Effect |
|---|---|
| `SIMPLELOGS_SERVER_KEY` | Passed to `simpleLogs({ serverKey })`. The secret server key; it never goes to a browser. |
| `NODE_ENV` | Passed as `environment`; defaults to `development`. |
| `PORT` | Listen port; defaults to `3100`. |

The SDK reads `SIMPLELOGS_API_ENDPOINT` from `process.env` itself; the app
never passes it. It sets the ingest base URL (for example
`http://localhost:4318/api/v1`) and defaults to the hosted collector. With
OTel started, the OTLP endpoint is derived from it: a trailing `/api/v1` is
replaced with `/api/otlp`, and any other value gets `/api/otlp` appended.
`SIMPLELOGS_OTLP_ENDPOINT` overrides the derived value. Because this is a Node process, the variable does
take effect here.

## Verifying a change

1. `npm install`.
2. Start a stand-in collector: a small `node:http` server that prints the path
   and body of every POST and answers `200 {}`. With OTel started, bodies are
   OTLP protobuf, so print them as base64 and decode them separately.
3. Boot the server against it:

   ```bash
   SIMPLELOGS_SERVER_KEY=sk_test SIMPLELOGS_API_ENDPOINT=http://localhost:4318/api/v1 npm start
   ```

   Loading OTel can take a few seconds, so wait for
   `Example API on http://localhost:3100` before sending requests.
4. Exercise the routes with the `curl` commands in the README. Send a
   `traceparent` header to check trace continuation.
5. Stop the server with `SIGTERM` or `Ctrl-C`; its handler calls
   `flushSimpleLogs()`, so the last batch reaches the collector.

What the collector receives depends on whether `initOtel()` ran:

- **OTel started** (as `src/server.js` does): `POST /api/otlp/v1/traces` and
  `POST /api/otlp/v1/logs`.
- **OTel not started**: one JSON `POST /api/v1/enqueue` per batch, holding
  timing and log entries.

Never truncate the collector's log while the collector holds the file open.
Stop it, or write each run to a new file.

## Tracing

- **With OTel started**, the middleware opens one span per request, named by
  its touchpoint (`orders/[id]`). An inbound `traceparent` is continued: the
  request span takes the caller's trace id and has the caller's span as its
  parent. With no `traceparent`, the request starts a new trace.
- **Without OTel**, there are no spans. Entries go to `/enqueue` with no trace
  or span ids, and an inbound `traceparent` is dropped.
- **`serverLogger.log()` in a route** joins the trace only when OTel is
  started. The log record carries the request span's trace id and span id.
  Without OTel, the entry has no trace or span id.
- **`serverLogger.start()`/`end()` in a route**, with OTel started, each
  become a span whose parent is the request span. Nesting does not change
  that: a `start()` opened inside another `start()` still gets the request
  span as its `parentSpanId`, not the enclosing timing. Without OTel, these
  are plain timing entries with no `parentSpanId`.
- **`next()` timing.** The middleware awaits nothing before calling `next()`.
  With OTel started, it opens the request span synchronously and calls
  `next()` inside that span's context, so the span is already open when the
  route runs. Without OTel, it calls `serverLogger.start()` without awaiting
  it and calls `next()` right away.
- Paths matched by `ignore` (`/healthz`, `/static/…`) are not timed and get
  no request scope, so no page or session correlation. The middleware still
  sets up the inbound trace context before calling `next()`.

## Docs style

Describe current behavior only. Leave history out of docs and comments. Use US
English.
