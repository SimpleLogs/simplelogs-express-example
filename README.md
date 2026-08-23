# SimpleLogs + Express

An Express API instrumented with
[`@simplelogs/express`](https://www.npmjs.com/package/@simplelogs/express). No
React, no rrweb — just your server.

The whole integration is **two middleware mounts**. Everything else in this
repo is the demo around them.

## Setup

You need a **server key** — SimpleLogs dashboard → **Settings → API Keys**.

```bash
cp .env.example .env     # paste your server key into SIMPLELOGS_SERVER_KEY
npm install
npm start                # http://localhost:3100
```

Requires Node 22 or newer (`--env-file-if-exists` loads `.env` with no `dotenv`
dependency). `npm run dev` restarts on change.

Then exercise it:

```bash
curl localhost:3100/orders/42
curl -X POST localhost:3100/checkout -H 'content-type: application/json' -d '{"items":[1,2]}'
curl localhost:3100/reports/revenue
curl localhost:3100/boom
```

## The integration

```js
import { simpleLogs, simpleLogsErrorHandler } from "@simplelogs/express";

app.use(simpleLogs({ serverKey: process.env.SIMPLELOGS_SERVER_KEY }));

// ... your routes ...

app.use(simpleLogsErrorHandler());
```

`simpleLogs()` goes **before** your routes; `simpleLogsErrorHandler()` goes
**after** them. Nothing between the two has to change.

## What the two mounts give you

| | |
|---|---|
| A timing per request | `orders/[id]`, with method and status in metadata |
| Ambient correlation | `serverLogger.log()` inside a handler needs no `req` argument |
| Status logging | 5xx at `error`, 4xx at `warning` |
| Uncaught errors | Logged with their stack, then re-raised to your own handler |

## How requests are named

The touchpoint is the request path, with dynamic segments masked and the
leading slash dropped: `/orders/42` and `/orders/43` both record as
`orders/[id]`, and a router mounted at `/api` gives `api/orders/[id]`.

One touchpoint per route is what keeps the data aggregatable — a touchpoint per
order id would make percentiles meaningless. The HTTP method rides in metadata,
so `GET` and `POST` to the same path share a touchpoint. To split them:

```js
simpleLogs({ touchpoint: (req) => `${req.method} ${req.path}` })
```

Use the exported `routePattern()` if you write your own namer and still want id
masking.

## What this API demonstrates

[`src/server.js`](src/server.js), in order:

| Route | Shows |
|---|---|
| `GET /orders/:id` | A request timed with no logging code at all |
| `POST /checkout` | `serverLogger.log()` inside a handler — no `req` needed |
| `GET /reports/revenue` | `start()` / `end()` timing a sub-operation inside the request |
| `GET /boom` | An uncaught error, logged by the error handler and re-raised |
| `GET /healthz` | Skipped via `ignore`, so probes do not swamp the data |

## Correlating with a browser

If your frontend uses `@simplelogs/browser`, `@simplelogs/react` or
`@simplelogs/next`, its patched `fetch` forwards page, session and trace
headers on same-origin requests. This middleware reads them, so a slow API call
shows up **inside** the page's trace rather than as an unattached server span.

Neither side passes an id explicitly. It works as soon as both are installed.

## Shutting down

Entries are batched. The SDK flushes on `beforeExit`, but a container killed
with `SIGTERM` never reaches that — deliberately, since installing a signal
handler in a library would suppress Node's default termination and hang
containers that expect to die on a signal.

The end of [`src/server.js`](src/server.js) shows the explicit
`flushSimpleLogs()` in your own handler.

## Which key goes here

The **server** key, and only ever that one. It is secret, it stays on the
server, and `.env` is gitignored so it is not committed. The client key is a
different value, for browsers.

## Other examples

| Your app | Example | Package |
|---|---|---|
| Express | **this repo** | `@simplelogs/express` |
| Node, any other server framework | [simplelogs-node-example](https://github.com/SimpleLogs/simplelogs-node-example) | `@simplelogs/node` |
| Plain HTML / any framework | [simplelogs-vanilla-example](https://github.com/SimpleLogs/simplelogs-vanilla-example) | `@simplelogs/browser` |
| React (Vite, CRA, Remix, React Router) | [simplelogs-react-example](https://github.com/SimpleLogs/simplelogs-react-example) | `@simplelogs/react` |
| Next.js | [simplelogs-next-example](https://github.com/SimpleLogs/simplelogs-next-example) | `@simplelogs/next` |

Frontend and backend packages are complementary, not alternatives — a React app
with an Express API installs `@simplelogs/react` in the client and
`@simplelogs/express` in the server, and the two correlate automatically.
