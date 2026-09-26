const http = require("http");
const { createLocalBus } = require("../../shared/localQueue");
const { createPipeline, drainQueue } = require("../event-pipeline");
const { startIngestServer } = require("../ingest-server");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function postJson(port, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function testDeadLetter() {
  const bus = createLocalBus({ maxReceiveCount: 3 });
  bus.send("sales-events", { store_id: "store_9", sku_id: "sku_9", quantity_sold: 1 });
  let attempts = 0;
  const failing = async () => {
    attempts += 1;
    throw new Error("forced failure");
  };
  await drainQueue(bus, "sales-events", failing);
  assert(attempts === 3, `expected 3 attempts before DLQ, got ${attempts}`);
  assert(bus.dlqDepth("sales-events") === 1, "poison message should land on the DLQ");
  assert(bus.depth("sales-events") === 0, "DLQ should remove the message from the main queue");
  console.log("OK: poison message retried 3 times then moved to the DLQ");
}

async function testHappyPath() {
  const pipeline = createPipeline();
  const quantities = [10, 12, 14, 16, 19, 21];
  for (const quantity of quantities) {
    pipeline.enqueueSale({ store_id: "store_2", sku_id: "sku_4", quantity_sold: quantity, source: "pos" });
  }
  assert(pipeline.bus.depth("sales-events") === quantities.length, "sales burst should sit on the queue before drain");

  const result = await pipeline.drain();
  console.log(JSON.stringify({
    forecasts: result.forecasts,
    orders: result.orders,
    elapsedMs: result.elapsedMs,
    queues: result.queues,
  }, null, 2));

  assert(result.forecasts.length === 1, "expected one latest forecast for store_2#sku_4");
  assert(result.forecasts[0].forecastQuantity > 10, "exponential smoothing should trend upward");
  assert(result.orders.length === 1, "low stock plus rising demand should create one order");
  assert(result.orders[0].sku_id === "sku_4", "order should be for sku_4");
  assert(result.queues.salesDepth === 0, "sales queue should be empty after a successful drain");
  assert(result.queues.salesDlq === 0, "happy path should not use the DLQ");
  console.log(`OK: queue pipeline created order ${result.orders[0].orderId} for ${result.orders[0].orderQuantity} units`);
}

async function testIngestHttp() {
  const pipeline = createPipeline();
  const running = await startIngestServer(pipeline, 0);
  try {
    const shelf = await postJson(running.port, "/ingest/shelf", {
      store_id: "store_2",
      sku_id: "sku_4",
      quantity: 8,
    });
    assert(shelf.status === 202, `shelf ingest status ${shelf.status}`);

    const bad = await postJson(running.port, "/ingest/pos", { store_id: "store_2" });
    assert(bad.status === 400, "malformed POS event should be rejected");

    const pos = await postJson(running.port, "/ingest/pos", {
      store_id: "store_2",
      sku_id: "sku_4",
      quantity_sold: 25,
      source: "pos",
    });
    assert(pos.status === 202, `pos ingest status ${pos.status}`);

    const result = await pipeline.drain();
    assert(result.orders.length === 1, "HTTP ingest should flow through to an order");
    console.log("OK: HTTP ingest accepted a shelf update and a POS event, then created an order");
  } finally {
    await running.close();
  }
}

async function main() {
  await testDeadLetter();
  await testHappyPath();
  await testIngestHttp();
  console.log("\nQueue pipeline tests passed.");
}

main().catch((err) => {
  console.error("Queue pipeline test failed:", err);
  process.exit(1);
});
