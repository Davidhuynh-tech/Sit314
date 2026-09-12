const { handler } = require("../handler");

async function main() {
  // Simulate a rolling week of POS sales for one store-SKU, SQS-record shaped.
  const quantities = [12, 15, 9, 20, 14, 18, 22];
  const events = quantities.map((q) => ({
    body: JSON.stringify({ store_id: "store_1", sku_id: "sku_1", quantity_sold: q, source: "pos" }),
  }));

  const result = await handler({ Records: events });
  console.log("Forecasting service — local test result:");
  console.log(JSON.stringify(result, null, 2));

  const last = result.results[result.results.length - 1];
  if (last && typeof last.forecastQuantity === "number") {
    console.log(`\nOK: produced a numeric forecast (${last.forecastQuantity}) after ${last.sampleSize} observations.`);
  } else {
    console.error("FAIL: no numeric forecast produced");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
