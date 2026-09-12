const { handler } = require("../handler");

async function main() {
  const scenarios = [
    { name: "Healthy stock, low forecast — should NOT order", store_id: "store_1", sku_id: "sku_1", forecastQuantity: 3 },
    { name: "Stock below threshold — SHOULD order", store_id: "store_2", sku_id: "sku_4", forecastQuantity: 4 },
    { name: "Stock above threshold but high demand forecast — SHOULD order", store_id: "store_1", sku_id: "sku_1", forecastQuantity: 15 },
  ];

  for (const s of scenarios) {
    const event = { Records: [{ body: JSON.stringify({ store_id: s.store_id, sku_id: s.sku_id, forecastQuantity: s.forecastQuantity }) }] };
    const result = await handler(event);
    console.log(`\n--- ${s.name} ---`);
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
