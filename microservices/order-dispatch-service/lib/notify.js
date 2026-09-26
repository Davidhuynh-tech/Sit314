/**
 * Notification stub. In production this would call SNS/SES to notify
 * store staff and/or the supplier - stubbed here to keep the service
 * testable locally without AWS credentials.
 */

async function notifyStoreStaff(order) {
  const message = `Store ${order.store_id}: replenishment order ${order.orderId} created for ${order.orderQuantity} units of ${order.sku_id} (reason: ${order.reason}).`;
  console.log(`[notify] ${message}`);
  const { publishSns } = require("../../../shared/awsPublish");
  const sns = await publishSns(message);
  if (sns) return sns;
  return { channel: "console-stub", message, sentAt: new Date().toISOString() };
}

module.exports = { notifyStoreStaff };
