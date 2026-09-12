/**
 * Order Dispatch & Notification microservice - Lambda/SQS handler.
 *
 * Consumes order-request events emitted by the Replenishment Decision
 * service (via SQS in prod - Week 5 wiring), creates the supplier order
 * record, and notifies store staff.
 */

const { createOrder } = require("./lib/dispatch");
const { notifyStoreStaff } = require("./lib/notify");
const { createInMemoryStore } = require("./lib/store");

const store = createInMemoryStore();

exports.handler = async (event) => {
  const records = event.Records || [event];
  const createdOrders = [];

  for (const record of records) {
    let orderRequest;
    try {
      orderRequest = record.body ? JSON.parse(record.body) : record;
    } catch (e) {
      console.warn("Skipping unparseable order request", record);
      continue;
    }

    if (!orderRequest.store_id || !orderRequest.sku_id || !orderRequest.orderQuantity) {
      console.warn("Skipping incomplete order request", orderRequest);
      continue;
    }

    const order = createOrder(orderRequest);
    await store.saveOrder(order);
    const notification = notifyStoreStaff(order);

    createdOrders.push({ order, notification });
  }

  return { ordersCreated: createdOrders.length, orders: createdOrders.map((c) => c.order) };
};

exports._store = store;
