const http = require("http");
const { createPipeline } = require("./event-pipeline");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function accept(pipeline, pathname, body) {
  if (pathname === "/ingest/pos") {
    pipeline.enqueueSale(body);
    return { status: 202, body: { accepted: true, queue: "sales-events" } };
  }
  if (pathname === "/ingest/shelf") {
    const stock = await pipeline.enqueueShelf(body);
    return { status: 202, body: { accepted: true, stock } };
  }
  if (pathname === "/orders") {
    return { status: 200, body: { orders: await dispatchOrders() } };
  }
  if (pathname === "/health") {
    return { status: 200, body: { ok: true } };
  }
  return { status: 404, body: { error: "not found" } };
}

function dispatchOrders() {
  const dispatch = require("./order-dispatch-service/handler");
  return dispatch._store.listOrders();
}

function startIngestServer(pipeline, port) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = (req.url || "/").split("?")[0];
      if (req.method === "GET") {
        const result = await accept(pipeline, pathname, null);
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "method not allowed" }));
        return;
      }
      const body = await readBody(req);
      const result = await accept(pipeline, pathname, body);
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      const status = err.message && err.message.includes("requires") ? 400 : 400;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  const timer = setInterval(() => {
    pipeline.drain().catch((err) => console.error("[ingest] drain failed", err.message));
  }, 400);

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: address.port,
        server,
        close() {
          clearInterval(timer);
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

async function main() {
  const pipeline = createPipeline();
  const port = Number(process.env.INGEST_PORT || 1881);
  const running = await startIngestServer(pipeline, port);
  console.log(`[ingest] listening on http://127.0.0.1:${running.port}`);
  console.log("[ingest] POST /ingest/pos  -> sales-events queue");
  console.log("[ingest] POST /ingest/shelf -> StockLevels");
  console.log("[ingest] GET  /orders");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { startIngestServer, accept };
