const { computeForecast } = require("./lib/forecast");
const { createInMemoryStore, createFileStore, createDynamoDbStore } = require("./lib/store");
const { sendSqs, archiveSale } = require("../../shared/awsPublish");

function createStore() {
  const backend = (process.env.STORAGE_BACKEND || "memory").toLowerCase();
  if (backend === "dynamodb") return createDynamoDbStore();
  if (backend === "file") return createFileStore();
  return createInMemoryStore();
}

const store = createStore();

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
    await archiveSale({
      store_id: payload.store_id,
      sku_id: payload.sku_id,
      quantity,
      timestamp: new Date().toISOString(),
    });

    results.push({ store_id: payload.store_id, sku_id: payload.sku_id, ...forecast });
  }

  const latest = new Map();
  for (const row of results) latest.set(`${row.store_id}#${row.sku_id}`, row);
  for (const row of latest.values()) {
    await sendSqs(process.env.FORECAST_QUEUE_URL, {
      store_id: row.store_id,
      sku_id: row.sku_id,
      forecastQuantity: row.forecastQuantity,
      confidence: row.confidence,
      sampleSize: row.sampleSize,
    });
  }

  return { processed: results.length, results };
};

// Exposed for the local test harness / future unit tests.
exports._store = store;
