async function sendSqs(queueUrl, body) {
  if (!queueUrl) return;
  const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
  const client = new SQSClient({});
  await client.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(body),
  }));
}

async function archiveSale(record) {
  const bucket = process.env.SALES_ARCHIVE_BUCKET;
  if (!bucket) return;
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  const client = new S3Client({});
  const key = `sales/${record.store_id}/${record.sku_id}/${record.timestamp}.json`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(record),
    ContentType: "application/json",
  }));
}

async function publishSns(message) {
  const topicArn = process.env.SNS_TOPIC_ARN;
  if (!topicArn) return null;
  const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
  const client = new SNSClient({});
  const res = await client.send(new PublishCommand({ TopicArn: topicArn, Message: message }));
  return { channel: "sns", messageId: res.MessageId, message, sentAt: new Date().toISOString() };
}

async function writeOrderToAurora(order) {
  const resourceArn = process.env.AURORA_RESOURCE_ARN;
  const secretArn = process.env.AURORA_SECRET_ARN;
  if (!resourceArn || !secretArn) return;
  const { RDSDataClient, ExecuteStatementCommand } = require("@aws-sdk/client-rds-data");
  const client = new RDSDataClient({});
  await client.send(new ExecuteStatementCommand({
    resourceArn,
    secretArn,
    database: process.env.AURORA_DATABASE || "replenishment",
    sql: "INSERT INTO orders (order_id, store_id, sku_id, order_quantity, reason, status) VALUES (:orderId, :storeId, :skuId, :qty, :reason, :status)",
    parameters: [
      { name: "orderId", value: { stringValue: order.orderId } },
      { name: "storeId", value: { stringValue: order.store_id } },
      { name: "skuId", value: { stringValue: order.sku_id } },
      { name: "qty", value: { longValue: order.orderQuantity } },
      { name: "reason", value: { stringValue: order.reason || "" } },
      { name: "status", value: { stringValue: order.status || "CREATED" } },
    ],
  }));
}

module.exports = { sendSqs, archiveSale, publishSns, writeOrderToAurora };
