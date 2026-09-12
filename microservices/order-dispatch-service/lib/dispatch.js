/**
 * Order creation logic - Week 5 per the Task 1 plan.
 * Creates a supplier order record from an approved replenishment decision.
 */

let orderCounter = 0;

function createOrder({ store_id, sku_id, orderQuantity, reason, supplierId = "default-supplier" }) {
  orderCounter += 1;
  return {
    orderId: `ORD-${Date.now()}-${orderCounter}`,
    store_id,
    sku_id,
    orderQuantity,
    supplierId,
    reason,
    status: "CREATED",
    createdAt: new Date().toISOString(),
  };
}

module.exports = { createOrder };
