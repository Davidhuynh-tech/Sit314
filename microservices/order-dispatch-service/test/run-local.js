const { handler } = require("../handler");

async function main() {
  const orderRequests = [
    { store_id: "store_2", sku_id: "sku_4", orderQuantity: 21, reason: "current_stock_at_or_below_threshold" },
    { store_id: "store_1", sku_id: "sku_1", orderQuantity: 50, reason: "projected_stockout_before_lead_time_elapses" },
  ];

  const event = { Records: orderRequests.map((r) => ({ body: JSON.stringify(r) })) };
  const result = await handler(event);

  console.log("Order dispatch service — local test result:");
  console.log(JSON.stringify(result, null, 2));

  if (result.ordersCreated === 2) {
    console.log("\nOK: both orders created successfully.");
  } else {
    console.error("FAIL: expected 2 orders created");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
