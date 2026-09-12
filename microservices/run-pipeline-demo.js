const forecasting = require("./forecasting-service/handler");
const replenishment = require("./replenishment-decision-service/handler");
const dispatch = require("./order-dispatch-service/handler");

async function main() {
  console.log("=== STAGE 1: Forecasting service ===");
  // A rising sales trend for store_2 / sku_4, which already has low seeded
  // stock in the Replenishment Decision service's demo data - this should
  // flow all the way through to a created order.
  const posEvents = [10, 12, 14, 16, 19, 21].map((q) => ({
    body: JSON.stringify({ store_id: "store_2", sku_id: "sku_4", quantity_sold: q, source: "pos" }),
  }));
  const forecastResult = await forecasting.handler({ Records: posEvents });
  console.log(JSON.stringify(forecastResult, null, 2));

  const latestForecast = forecastResult.results[forecastResult.results.length - 1];

  console.log("\n=== STAGE 2: Replenishment Decision service ===");
  const decisionEvent = {
    Records: [{ body: JSON.stringify({ store_id: latestForecast.store_id, sku_id: latestForecast.sku_id, forecastQuantity: latestForecast.forecastQuantity }) }],
  };
  const decisionResult = await replenishment.handler(decisionEvent);
  console.log(JSON.stringify(decisionResult, null, 2));

  if (decisionResult.ordersRequested === 0) {
    console.log("\nNo order was requested for this scenario - pipeline stops here (this is correct behaviour, not a failure).");
    return;
  }

  console.log("\n=== STAGE 3: Order Dispatch & Notification service ===");
  const dispatchEvent = { Records: decisionResult.orderRequests.map((r) => ({ body: JSON.stringify(r) })) };
  const dispatchResult = await dispatch.handler(dispatchEvent);
  console.log(JSON.stringify(dispatchResult, null, 2));

  console.log(`\nEnd-to-end pipeline complete: ${dispatchResult.ordersCreated} order(s) created from ${posEvents.length} raw POS events.`);
}

main().catch((err) => {
  console.error("Pipeline demo failed:", err);
  process.exit(1);
});
