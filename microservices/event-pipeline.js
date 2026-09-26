const forecasting = require("./forecasting-service/handler");
const replenishment = require("./replenishment-decision-service/handler");
const dispatch = require("./order-dispatch-service/handler");
const { createLocalBus, QUEUES } = require("../shared/localQueue");

function latestByKey(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!row || !row.store_id || !row.sku_id) continue;
    byKey.set(`${row.store_id}#${row.sku_id}`, row);
  }
  return [...byKey.values()];
}

async function drainQueue(bus, name, handler) {
  const results = [];
  let batches = 0;
  while (batches < 100000) {
    const records = bus.receive(name, 10);
    if (!records.length) break;
    batches += 1;
    try {
      const result = await handler({ Records: records });
      for (const record of records) bus.delete(name, record.receiptHandle);
      results.push(result);
    } catch (err) {
      for (const record of records) bus.nack(name, record.receiptHandle);
      console.warn(`[pipeline] ${name} batch failed (${err.message}); message will retry or move to the DLQ`);
    }
  }
  return results;
}

function createPipeline(bus = createLocalBus()) {
  return {
    bus,

    enqueueSale(event) {
      if (!event || !event.store_id || !event.sku_id || typeof event.quantity_sold !== "number") {
        throw new Error("POS event requires store_id, sku_id and numeric quantity_sold");
      }
      return bus.send(QUEUES.sales, { ...event, enqueuedAt: event.enqueuedAt || new Date().toISOString() });
    },

    async enqueueShelf(reading) {
      if (!reading || !reading.store_id || !reading.sku_id || typeof reading.quantity !== "number") {
        throw new Error("Shelf reading requires store_id, sku_id and numeric quantity");
      }
      const key = `${reading.store_id}#${reading.sku_id}`;
      const existing = await replenishment._store.getStockInfo(key);
      await replenishment._store.setStockInfo(key, {
        ...existing,
        currentStock: reading.quantity,
        updatedAt: new Date().toISOString(),
      });
      return { key, currentStock: reading.quantity };
    },

    async drain() {
      const started = Date.now();
      const forecastBatches = await drainQueue(bus, QUEUES.sales, forecasting.handler);
      const forecastRows = latestByKey(forecastBatches.flatMap((batch) => batch.results || []));
      for (const row of forecastRows) {
        bus.send(QUEUES.forecast, {
          store_id: row.store_id,
          sku_id: row.sku_id,
          forecastQuantity: row.forecastQuantity,
          confidence: row.confidence,
          sampleSize: row.sampleSize,
        });
      }

      const decisionBatches = await drainQueue(bus, QUEUES.forecast, replenishment.handler);
      const orderRequests = decisionBatches.flatMap((batch) => batch.orderRequests || []);
      for (const request of orderRequests) bus.send(QUEUES.approved, request);

      const dispatchBatches = await drainQueue(bus, QUEUES.approved, dispatch.handler);
      const orders = dispatchBatches.flatMap((batch) => batch.orders || []);

      return {
        forecasts: forecastRows,
        decisions: decisionBatches,
        orders,
        elapsedMs: Date.now() - started,
        queues: {
          salesDepth: bus.depth(QUEUES.sales),
          salesPeak: bus.peak(QUEUES.sales),
          salesDlq: bus.dlqDepth(QUEUES.sales),
          forecastDlq: bus.dlqDepth(QUEUES.forecast),
          approvedDlq: bus.dlqDepth(QUEUES.approved),
        },
      };
    },
  };
}

module.exports = { createPipeline, drainQueue, QUEUES };
