function createInMemoryStore() {
  const salesHistory = new Map(); // key: `${store_id}#${sku_id}` -> number[]
  const forecasts = new Map();    // key -> forecast object
  const ROLLING_WINDOW = 30;      // keep last 30 observations per store-SKU

  return {
    async appendSale(key, quantity) {
      const arr = salesHistory.get(key) || [];
      arr.push(quantity);
      if (arr.length > ROLLING_WINDOW) arr.shift();
      salesHistory.set(key, arr);
      return arr;
    },
    async getHistory(key) {
      return salesHistory.get(key) || [];
    },
    async saveForecast(key, forecast) {
      forecasts.set(key, forecast);
      return forecast;
    },
    async getForecast(key) {
      return forecasts.get(key);
    },
    _dump() {
      return { salesHistory: Object.fromEntries(salesHistory), forecasts: Object.fromEntries(forecasts) };
    },
  };
}

function createDynamoDbStore(tableNames = { history: "SalesEvents", forecast: "ForecastResults" }) {
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  return {
    async appendSale(key, quantity) {
      const [store_id, sku_id] = key.split("#");
      return client.send(new PutCommand({
        TableName: tableNames.history,
        Item: { store_id_sku_id: key, timestamp: new Date().toISOString(), store_id, sku_id, quantity },
      }));
    },
    async getHistory(key) {
      const res = await client.send(new QueryCommand({
        TableName: tableNames.history,
        KeyConditionExpression: "store_id_sku_id = :k",
        ExpressionAttributeValues: { ":k": key },
        ScanIndexForward: false,
        Limit: 30,
      }));
      return (res.Items || []).map((i) => i.quantity).reverse();
    },
    async saveForecast(key, forecast) {
      return client.send(new PutCommand({
        TableName: tableNames.forecast,
        Item: { store_id_sku_id: key, updated_at: new Date().toISOString(), ...forecast },
      }));
    },
    async getForecast(key) {
      throw new Error("getForecast via DynamoDB not yet implemented - Week 6 task");
    },
  };
}

module.exports = { createInMemoryStore, createDynamoDbStore };
