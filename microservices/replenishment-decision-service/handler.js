/**
 * Replenishment Decision microservice - Lambda handler.
 *
 * In AWS this is triggered by forecast results published from the
 * Forecasting service (via EventBridge/SQS - Week 5 wiring). For each
 * forecast, it looks up current stock and supplier lead time, decides
 * whether to order, and - if so - emits an "order request" event for
 * the Order Dispatch service to consume.
 */

const { decideReplenishment } = require("./lib/decision");
const { createInMemoryStore, createFileStore, createDynamoDbStore } = require("./lib/store");
const { sendSqs } = require("../../shared/awsPublish");

const DEMO_STOCK = {
  "store_1#sku_1": { currentStock: 40, reorderThreshold: 15, supplierLeadTimeDays: 3 },
  "store_2#sku_4": { currentStock: 10, reorderThreshold: 15, supplierLeadTimeDays: 2 },
};

function createStore() {
  const backend = (process.env.STORAGE_BACKEND || "memory").toLowerCase();
  if (backend === "dynamodb") return createDynamoDbStore();
  if (backend === "file") return createFileStore(DEMO_STOCK);
  return createInMemoryStore(DEMO_STOCK);
}

const store = createStore();

/**
 * @param {Object} event - forecast result(s), e.g. { Records: [{ body: '{"store_id":...,"sku_id":...,"forecastQuantity":...}' }] }
 * @param {Function} [publishOrderRequest] - injectable publish function (SQS/EventBridge in prod);
 *        defaults to collecting requests in-memory for the local test harness / pipeline demo.
 */
exports.handler = async (event, publishOrderRequest) => {
  const records = event.Records || [event];
  const orderRequests = [];
  const publish = typeof publishOrderRequest === "function"
    ? publishOrderRequest
    : (req) => orderRequests.push(req);

  for (const record of records) {
    let forecast;
    try {
      forecast = record.body ? JSON.parse(record.body) : record;
    } catch (e) {
      console.warn("Skipping unparseable forecast record", record);
      continue;
    }

    if (!forecast.store_id || !forecast.sku_id) {
      console.warn("Skipping forecast missing store_id/sku_id", forecast);
      continue;
    }

    const key = `${forecast.store_id}#${forecast.sku_id}`;
    const stockInfo = await store.getStockInfo(key);

    const decision = decideReplenishment({
      forecastQuantity: forecast.forecastQuantity ?? 0,
      currentStock: stockInfo.currentStock,
      reorderThreshold: stockInfo.reorderThreshold,
      supplierLeadTimeDays: stockInfo.supplierLeadTimeDays,
    });

    if (decision.shouldOrder) {
      const orderRequest = {
        store_id: forecast.store_id,
        sku_id: forecast.sku_id,
        orderQuantity: decision.orderQuantity,
        reason: decision.reason,
        requestedAt: new Date().toISOString(),
      };
      publish(orderRequest);
      if (typeof publishOrderRequest !== "function") {
        await sendSqs(process.env.ORDER_QUEUE_URL, orderRequest);
      }
    }
  }

  return { evaluated: records.length, ordersRequested: orderRequests.length, orderRequests };
};

exports._store = store;
