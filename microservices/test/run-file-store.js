const fs = require("fs");
const path = require("path");

process.env.STORAGE_BACKEND = "file";

const dataDir = path.join(__dirname, "..", "..", "data");
fs.rmSync(dataDir, { recursive: true, force: true });

const forecasting = require("../forecasting-service/handler");
const replenishment = require("../replenishment-decision-service/handler");
const dispatch = require("../order-dispatch-service/handler");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const forecast = await forecasting.handler({
    Records: [
      { body: JSON.stringify({ store_id: "store_2", sku_id: "sku_4", quantity_sold: 11 }) },
      { body: JSON.stringify({ store_id: "store_2", sku_id: "sku_4", quantity_sold: 18 }) },
    ],
  });
  assert(forecast.results.length === 2, "file-backed forecasting should return both results");
  assert(fs.existsSync(path.join(dataDir, "sales-events.json")), "sales history should be persisted");
  assert(fs.existsSync(path.join(dataDir, "forecast-results.json")), "forecast should be persisted");

  const saved = await forecasting._store.getForecast("store_2#sku_4");
  assert(saved && typeof saved.forecastQuantity === "number", "getForecast should read the persisted forecast");

  const decision = await replenishment.handler({
    Records: [{ body: JSON.stringify({ store_id: "store_2", sku_id: "sku_4", forecastQuantity: saved.forecastQuantity }) }],
  });
  assert(decision.ordersRequested === 1, "seeded low stock should request an order");

  const created = await dispatch.handler({
    Records: decision.orderRequests.map((request) => ({ body: JSON.stringify(request) })),
  });
  assert(created.ordersCreated === 1, "dispatch should persist one order");
  const listed = await dispatch._store.listOrders();
  assert(listed.length === 1, "order should be readable back from the file store");
  console.log("OK: file-backed DynamoDB stand-in persisted sales, forecast, and the supplier order");
}

main().catch((err) => {
  console.error("File store test failed:", err);
  process.exit(1);
});
