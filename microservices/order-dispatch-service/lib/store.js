/**
 * Pluggable storage adapter for supplier/order records
 * (Task 1 Section 3.2: Aurora / DynamoDB - Suppliers & Orders).
 */

function createInMemoryStore() {
  const orders = new Map();
  return {
    async saveOrder(order) {
      orders.set(order.orderId, order);
      return order;
    },
    async getOrder(orderId) {
      return orders.get(orderId);
    },
    async listOrders() {
      return [...orders.values()];
    },
  };
}

function createFileStore() {
  const { createJsonTable } = require("../../../shared/jsonTable");
  const orders = createJsonTable("orders.json");
  return {
    async saveOrder(order) {
      return orders.put(order.orderId, order);
    },
    async getOrder(orderId) {
      return orders.get(orderId);
    },
    async listOrders() {
      return orders.values();
    },
  };
}

function createDynamoDbStore(tableName = "SuppliersAndOrders") {
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  return {
    async saveOrder(order) {
      return client.send(new PutCommand({ TableName: tableName, Item: order }));
    },
    async getOrder(orderId) {
      const res = await client.send(new GetCommand({ TableName: tableName, Key: { orderId } }));
      return res.Item;
    },
    async listOrders() {
      const res = await client.send(new ScanCommand({ TableName: tableName }));
      return res.Items || [];
    },
  };
}

module.exports = { createInMemoryStore, createFileStore, createDynamoDbStore };
