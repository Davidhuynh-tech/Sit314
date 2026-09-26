/**
 * Deploy the Week 6-8 lab resources into the open Learner Lab account.
 * Requires AWS credentials in the environment (CloudShell, or the lab's
 * temporary access key / secret / session token).
 *
 *   $env:AWS_ACCESS_KEY_ID = "..."
 *   $env:AWS_SECRET_ACCESS_KEY = "..."
 *   $env:AWS_SESSION_TOKEN = "..."
 *   $env:AWS_DEFAULT_REGION = "us-east-1"
 *   node scripts/lab/deploy.js
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REGION = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1";
const ROOT = path.join(__dirname, "..", "..");
const DIST = path.join(ROOT, "dist");

function sdk(name) {
  return require(path.join(__dirname, "node_modules", name));
}

function ignore(err, codes) {
  if (err && codes.includes(err.name)) return true;
  throw err;
}

async function ensureQueue(sqs, name, dlqArn) {
  const { CreateQueueCommand, GetQueueUrlCommand } = sdk("@aws-sdk/client-sqs");
  const attributes = dlqArn
    ? { RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: "3" }), VisibilityTimeout: "60" }
    : {};
  try {
    const created = await sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
    return created.QueueUrl;
  } catch (err) {
    if (err.name !== "QueueNameExists") throw err;
    const existing = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    return existing.QueueUrl;
  }
}

async function queueArn(sqs, url) {
  const { GetQueueAttributesCommand } = sdk("@aws-sdk/client-sqs");
  const res = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }));
  return res.Attributes.QueueArn;
}

async function ensureTable(dynamo, input) {
  const { CreateTableCommand } = sdk("@aws-sdk/client-dynamodb");
  try {
    await dynamo.send(new CreateTableCommand(input));
    console.log("created table", input.TableName);
  } catch (err) {
    ignore(err, ["ResourceInUseException"]);
    console.log("table exists", input.TableName);
  }
}

function packageService(folderName) {
  const stage = path.join(DIST, folderName);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, "lib"), { recursive: true });
  const source = path.join(ROOT, "microservices", folderName);
  fs.copyFileSync(path.join(source, "handler.js"), path.join(stage, "handler.js"));
  for (const file of fs.readdirSync(path.join(source, "lib"))) {
    fs.copyFileSync(path.join(source, "lib", file), path.join(stage, "lib", file));
  }
  fs.mkdirSync(path.join(stage, "shared"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "shared", "awsPublish.js"), path.join(stage, "shared", "awsPublish.js"));
  const handler = fs.readFileSync(path.join(stage, "handler.js"), "utf8").replace('require("../../shared/awsPublish")', 'require("./shared/awsPublish")');
  fs.writeFileSync(path.join(stage, "handler.js"), handler);
  const notify = path.join(stage, "lib", "notify.js");
  if (fs.existsSync(notify)) {
    fs.writeFileSync(notify, fs.readFileSync(notify, "utf8").replace('require("../../../shared/awsPublish")', 'require("../shared/awsPublish")'));
  }
  execSync("npm init -y", { cwd: stage, stdio: "ignore" });
  execSync("npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-sqs @aws-sdk/client-s3 @aws-sdk/client-sns @aws-sdk/client-rds-data --omit=dev", {
    cwd: stage,
    stdio: "inherit",
  });
  const zip = path.join(DIST, `${folderName}.zip`);
  if (fs.existsSync(zip)) fs.rmSync(zip);
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stage.replace(/'/g, "''")}\\*' -DestinationPath '${zip.replace(/'/g, "''")}'"`, { stdio: "inherit" });
  return zip;
}

async function ensureFunction(lambda, name, zip, roleArn, env) {
  const { CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, GetFunctionCommand } = sdk("@aws-sdk/client-lambda");
  const code = fs.readFileSync(zip);
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: name }));
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: code }));
    await new Promise((r) => setTimeout(r, 2000));
    await lambda.send(new UpdateFunctionConfigurationCommand({
      FunctionName: name,
      Role: roleArn,
      Environment: { Variables: env },
      Timeout: 30,
    }));
    console.log("updated function", name);
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
    await lambda.send(new CreateFunctionCommand({
      FunctionName: name,
      Runtime: "nodejs20.x",
      Role: roleArn,
      Handler: "handler.handler",
      Code: { ZipFile: code },
      Timeout: 30,
      Environment: { Variables: env },
    }));
    console.log("created function", name);
  }
}

async function ensureMapping(lambda, fn, queueArn) {
  const { ListEventSourceMappingsCommand, CreateEventSourceMappingCommand } = sdk("@aws-sdk/client-lambda");
  const existing = await lambda.send(new ListEventSourceMappingsCommand({ FunctionName: fn, EventSourceArn: queueArn }));
  if (existing.EventSourceMappings && existing.EventSourceMappings.length) return;
  await lambda.send(new CreateEventSourceMappingCommand({
    FunctionName: fn,
    EventSourceArn: queueArn,
    BatchSize: 10,
    Enabled: true,
  }));
}

async function ensureAlarm(cw, input) {
  const { PutMetricAlarmCommand } = sdk("@aws-sdk/client-cloudwatch");
  await cw.send(new PutMetricAlarmCommand(input));
}

async function main() {
  const { STSClient, GetCallerIdentityCommand } = sdk("@aws-sdk/client-sts");
  const sts = new STSClient({ region: REGION });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  const account = identity.Account;
  console.log("account", account, "region", REGION);

  const { SQSClient } = sdk("@aws-sdk/client-sqs");
  const { DynamoDBClient } = sdk("@aws-sdk/client-dynamodb");
  const { S3Client, CreateBucketCommand, HeadBucketCommand } = sdk("@aws-sdk/client-s3");
  const { SNSClient, CreateTopicCommand } = sdk("@aws-sdk/client-sns");
  const { CloudWatchClient } = sdk("@aws-sdk/client-cloudwatch");
  const { IAMClient, GetRoleCommand, CreateRoleCommand, PutRolePolicyCommand } = sdk("@aws-sdk/client-iam");
  const { LambdaClient } = sdk("@aws-sdk/client-lambda");

  const sqs = new SQSClient({ region: REGION });
  const salesDlq = await ensureQueue(sqs, "sales-events-dlq");
  const forecastDlq = await ensureQueue(sqs, "forecast-ready-dlq");
  const orderDlq = await ensureQueue(sqs, "replenishment-approved-dlq");
  const salesUrl = await ensureQueue(sqs, "sales-events", await queueArn(sqs, salesDlq));
  const forecastUrl = await ensureQueue(sqs, "forecast-ready", await queueArn(sqs, forecastDlq));
  const orderUrl = await ensureQueue(sqs, "replenishment-approved", await queueArn(sqs, orderDlq));
  console.log("queues ready");

  const dynamo = new DynamoDBClient({ region: REGION });
  await ensureTable(dynamo, {
    TableName: "SalesEvents",
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "store_id_sku_id", AttributeType: "S" },
      { AttributeName: "timestamp", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "store_id_sku_id", KeyType: "HASH" },
      { AttributeName: "timestamp", KeyType: "RANGE" },
    ],
  });
  for (const name of ["ForecastResults", "StockLevels"]) {
    await ensureTable(dynamo, {
      TableName: name,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "store_id_sku_id", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "store_id_sku_id", KeyType: "HASH" }],
    });
  }
  await ensureTable(dynamo, {
    TableName: "SuppliersAndOrders",
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "orderId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "orderId", KeyType: "HASH" }],
  });

  const bucket = `sit314-forecast-archive-${account}`;
  const s3 = new S3Client({ region: REGION });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  console.log("bucket", bucket);

  const sns = new SNSClient({ region: REGION });
  const topic = await sns.send(new CreateTopicCommand({ Name: "sit314-pipeline-alarms" }));
  const topicArn = topic.TopicArn;

  const cw = new CloudWatchClient({ region: REGION });
  const alarmBase = { Period: 60, EvaluationPeriods: 1, AlarmActions: [topicArn], TreatMissingData: "notBreaching" };
  await ensureAlarm(cw, { ...alarmBase, AlarmName: "sales-events-depth", Namespace: "AWS/SQS", MetricName: "ApproximateNumberOfMessagesVisible", Dimensions: [{ Name: "QueueName", Value: "sales-events" }], Statistic: "Maximum", EvaluationPeriods: 2, Threshold: 500, ComparisonOperator: "GreaterThanThreshold" });
  await ensureAlarm(cw, { ...alarmBase, AlarmName: "forecast-ready-age", Namespace: "AWS/SQS", MetricName: "ApproximateAgeOfOldestMessage", Dimensions: [{ Name: "QueueName", Value: "forecast-ready" }], Statistic: "Maximum", Threshold: 60, ComparisonOperator: "GreaterThanThreshold" });
  await ensureAlarm(cw, { ...alarmBase, AlarmName: "sales-events-throttled", Namespace: "AWS/DynamoDB", MetricName: "ThrottledRequests", Dimensions: [{ Name: "TableName", Value: "SalesEvents" }], Statistic: "Sum", EvaluationPeriods: 2, Threshold: 0, ComparisonOperator: "GreaterThanThreshold" });
  console.log("alarms ready");

  const iam = new IAMClient({ region: REGION });
  const roleName = "sit314-pipeline-role";
  const policyDocument = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource: "*" },
      { Effect: "Allow", Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:SendMessage"], Resource: `arn:aws:sqs:${REGION}:${account}:*` },
      { Effect: "Allow", Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"], Resource: `arn:aws:dynamodb:${REGION}:${account}:table/*` },
      { Effect: "Allow", Action: ["s3:PutObject", "s3:GetObject"], Resource: `arn:aws:s3:::${bucket}/*` },
      { Effect: "Allow", Action: "sns:Publish", Resource: topicArn },
      { Effect: "Allow", Action: ["rds-data:ExecuteStatement", "secretsmanager:GetSecretValue"], Resource: "*" },
    ],
  });
  let roleArn;
  try {
    try {
      roleArn = (await iam.send(new GetRoleCommand({ RoleName: roleName }))).Role.Arn;
    } catch (err) {
      if (err.name !== "NoSuchEntityException") throw err;
      const trust = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] });
      roleArn = (await iam.send(new CreateRoleCommand({ RoleName: roleName, AssumeRolePolicyDocument: trust }))).Role.Arn;
      console.log("created role", roleArn);
      await new Promise((r) => setTimeout(r, 10000));
    }
    await iam.send(new PutRolePolicyCommand({ RoleName: roleName, PolicyName: "pipeline-least-privilege", PolicyDocument: policyDocument }));
  } catch (err) {
    console.warn("Custom role was not allowed, using LabRole:", err.message);
    roleArn = (await iam.send(new GetRoleCommand({ RoleName: "LabRole" }))).Role.Arn;
  }

  console.log("packaging lambdas");
  const forecastingZip = packageService("forecasting-service");
  const decisionZip = packageService("replenishment-decision-service");
  const dispatchZip = packageService("order-dispatch-service");

  const lambda = new LambdaClient({ region: REGION });
  const commonEnv = {
    STORAGE_BACKEND: "dynamodb",
    SALES_ARCHIVE_BUCKET: bucket,
    SNS_TOPIC_ARN: topicArn,
    FORECAST_QUEUE_URL: forecastUrl,
    ORDER_QUEUE_URL: orderUrl,
  };
  await ensureFunction(lambda, "sit314-forecasting", forecastingZip, roleArn, commonEnv);
  await ensureFunction(lambda, "sit314-replenishment-decision", decisionZip, roleArn, commonEnv);
  await ensureFunction(lambda, "sit314-order-dispatch", dispatchZip, roleArn, commonEnv);
  await ensureMapping(lambda, "sit314-forecasting", await queueArn(sqs, salesUrl));
  await ensureMapping(lambda, "sit314-replenishment-decision", await queueArn(sqs, forecastUrl));
  await ensureMapping(lambda, "sit314-order-dispatch", await queueArn(sqs, orderUrl));
  await ensureAlarm(cw, { ...alarmBase, AlarmName: "forecasting-throttles", Namespace: "AWS/Lambda", MetricName: "Throttles", Dimensions: [{ Name: "FunctionName", Value: "sit314-forecasting" }], Statistic: "Sum", Threshold: 0, ComparisonOperator: "GreaterThanThreshold" });

  let aurora = { status: "not-created" };
  try {
    aurora = await ensureAurora(account);
  } catch (err) {
    aurora = { status: "failed", message: err.message };
    console.warn("Aurora was not created:", err.message);
  }

  const summary = {
    account,
    region: REGION,
    queues: { salesUrl, forecastUrl, orderUrl },
    bucket,
    topicArn,
    roleArn,
    functions: ["sit314-forecasting", "sit314-replenishment-decision", "sit314-order-dispatch"],
    tables: ["SalesEvents", "ForecastResults", "StockLevels", "SuppliersAndOrders"],
    aurora,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(ROOT, "docs", "aws_deploy_result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

async function ensureAurora() {
  const { EC2Client, DescribeSubnetsCommand, DescribeVpcsCommand } = sdk("@aws-sdk/client-ec2");
  const { RDSClient, CreateDBSubnetGroupCommand, CreateDBClusterCommand, CreateDBInstanceCommand, DescribeDBClustersCommand } = sdk("@aws-sdk/client-rds");
  const ec2 = new EC2Client({ region: REGION });
  const rds = new RDSClient({ region: REGION });
  const existing = await rds.send(new DescribeDBClustersCommand({ DBClusterIdentifier: "sit314-replenishment" })).catch((err) => {
    if (err.name === "DBClusterNotFoundFault") return null;
    throw err;
  });
  if (existing && existing.DBClusters && existing.DBClusters[0]) {
    return { status: "exists", arn: existing.DBClusters[0].DBClusterArn };
  }
  const vpcs = await ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: "isDefault", Values: ["true"] }] }));
  const vpcId = vpcs.Vpcs && vpcs.Vpcs[0] && vpcs.Vpcs[0].VpcId;
  if (!vpcId) throw new Error("No default VPC for Aurora");
  const subnets = await ec2.send(new DescribeSubnetsCommand({ Filters: [{ Name: "vpc-id", Values: [vpcId] }] }));
  const byAz = new Map();
  for (const subnet of subnets.Subnets || []) {
    if (!byAz.has(subnet.AvailabilityZone)) byAz.set(subnet.AvailabilityZone, subnet.SubnetId);
  }
  const subnetIds = [...byAz.values()].slice(0, 3);
  if (subnetIds.length < 2) throw new Error("Need two subnets in different AZs");
  try {
    await rds.send(new CreateDBSubnetGroupCommand({
      DBSubnetGroupName: "sit314-aurora-subnets",
      DBSubnetGroupDescription: "SIT314 replenishment Aurora",
      SubnetIds: subnetIds,
    }));
  } catch (err) {
    ignore(err, ["DBSubnetGroupAlreadyExistsFault"]);
  }
  const cluster = await rds.send(new CreateDBClusterCommand({
    DBClusterIdentifier: "sit314-replenishment",
    Engine: "aurora-postgresql",
    EngineMode: "provisioned",
    DatabaseName: "replenishment",
    MasterUsername: "sit314admin",
    ManageMasterUserPassword: true,
    ServerlessV2ScalingConfiguration: { MinCapacity: 0.5, MaxCapacity: 1 },
    DBSubnetGroupName: "sit314-aurora-subnets",
    EnableHttpEndpoint: true,
    StorageEncrypted: true,
    BackupRetentionPeriod: 1,
  }));
  await rds.send(new CreateDBInstanceCommand({
    DBInstanceIdentifier: "sit314-replenishment-1",
    DBClusterIdentifier: "sit314-replenishment",
    DBInstanceClass: "db.serverless",
    Engine: "aurora-postgresql",
  }));
  return { status: "creating", arn: cluster.DBCluster && cluster.DBCluster.DBClusterArn };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
