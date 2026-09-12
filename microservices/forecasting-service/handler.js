const { computeForecast } = require("./lib/forecast");
const { createInMemoryStore } = require("./lib/store");

// Local/demo store instance. In real Lambda deployment, swap this for
// createDynamoDbStore() from ./lib/store - the handler logic below does
// not need to change either way.
const store = createInMemoryStore();

exports.handler = async (event) => {
  const records = event.Records || [event]; // allow direct invocation with a single payload too
  const results = [];

  for (const record of records) {
    let payload;
    try {
      payload = record.body ? JSON.parse(record.body) : record;
    } catch (e) {
      console.warn("Skipping unparseable record", record);
      continue;
    }

    if (!payload.store_id || !payload.sku_id) {
      console.warn("Skipping event missing store_id/sku_id", payload);
      continue;
    }

    const key = `${payload.store_id}#${payload.sku_id}`;
    const quantity = payload.quantity_sold ?? payload.quantity ?? 0;

    await store.appendSale(key, quantity);
    const history = await store.getHistory(key);
    const forecast = computeForecast(history);
    await store.saveForecast(key, forecast);

    results.push({ store_id: payload.store_id, sku_id: payload.sku_id, ...forecast });
  }

  return { processed: results.length, results };
};

// Exposed for the local test harness / future unit tests.
exports._store = store;
