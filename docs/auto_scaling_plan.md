# Auto-Scaling Plan

**Project:** Demand Forecasting & Auto-Replenishment for Stocks
**Unit:** SIT314 — Cloud Enabling Technologies
**Student:** Gia Kiet Huynh (David) — 223482424

---

## 1. Purpose

This project  requires the pipeline to absorb a store-wide promotion — many stores and SKUs spiking at once — without failing, and to expose alarms so operators see a breaking point *before* a replenishment order is delayed.

Section 2.3 of the project plan named four components most likely to break under load:

| Component | Breaking point | Mitigation committed |
|---|---|---|
| Single Node-RED instance | CPU-bound flow runtime saturates during a multi-store promotion | Partition by `store_id`; multiple instances behind a load balancer |
| Lambda concurrency | Default account limit exhausted; invocations throttled | Reserved/provisioned concurrency; SQS burst buffer; quota increase if needed |
| DynamoDB partition key | `store_id` alone creates a hot partition | Composite key `store_id#sku_id`; on-demand capacity |
| Message-queue consumers | Consumers lag a producer burst; decisions delayed | Scale on `ApproximateNumberOfMessagesVisible`; DLQ for poison messages |

Week 7 will ramp simulated load until each limit is observed, apply the policies below, and re-test — the before/after evidence required for the final report.

## 2. Current system this plan scales

As of the Week 5 status update the following is already built and verified:

- Device layer: micro-sensor, card-reader, and in-store controller relaying to `stores/{id}/sensors/shelf` and `stores/{id}/pos/transactions` (AWS IoT Core MQTT).
- Node-RED flow: MQTT ingest, normalisation, noise filter, threshold low-stock alert, partitioned by `store_id`.
- Three Node.js microservices: Forecasting (exponential smoothing), Replenishment Decision, Order Dispatch & Notification. Each has a Lambda `handler.js` and a DynamoDB storage adapter ready to swap in at Week 6.
- Remaining before this plan can be *executed*: SQS/EventBridge wiring (in progress), DynamoDB/S3 provision, Lambda deploy.

Until SQS is wired, services are chained by direct invocation. Direct calls do **not** scale independently — that is why the event-buffer policies below are mandatory, not optional.

## 3. Scaling goals

- **Elastic, not fixed (NFR1, NFR7):** scale out under load and in when load drops, so cost tracks actual event volume.
- **Graceful degradation (NFR2, NFR3):** a mitigation must fire *before* the forecast-to-order cycle exceeds minutes, not after a stockout.
- **Independent scale (NFR6):** Forecasting, Decision, and Dispatch scale and fail separately.
- **Observable (NFR5):** every policy is tied to a named CloudWatch metric so Week 7 can prove it engaged.
- **Ceilinged (NFR7  cost risk):** every scale-out path has a hard max so a simulator bug cannot run away with the Learner Lab budget.

## 4. Per-component policies

Numbers below are **starting points** for Week 7. They will be tuned from measured p99 latency and error rate. Two scales are listed where the Learner Lab quota is expected to be lower than a production account.

### 4.1 AWS IoT Core (MQTT ingestion)

IoT Core is a managed broker; it does not use an Auto Scaling Group. The risk is throttling (connection, publish, or subscribe rate) if every simulated sensor opens its own cloud connection. The device architecture already mitigates this: only the **controller** (edge gateway) talks to IoT Core; shelf sensors and POS terminals stay on local topics.

| | |
|---|---|
| **What to watch** | `Connect.Throttle`, `PublishIn.Throttle`, `Subscribe.Throttle`, `RuleMessageThrottled` |
| **Alarm** | Any throttle count > 0 for 2 minutes |
| **Action** | Cap simulator connection count; keep one MQTT client per store controller; do not attach every micro-sensor as its own IoT Thing during load tests |
| **Week 7 check** | Confirm connection count ≈ number of stores (not stores × SKUs) |

### 4.2 Node-RED (ingestion and first-pass processing)

Breaking point: one flow runtime is CPU-bound and cannot process a store-wide promotion.

| | |
|---|---|
| **Deployment** | ECS Fargate (preferred) or EC2 Auto Scaling Group, behind an Application Load Balancer. In Learner Lab, start with a single EC2/ECS task and add a second instance if the lab quota allows. |
| **Partitioning** | Each instance owns a consistent-hash range of `store_id`. MQTT subscriptions are `stores/{owned_ids}/#`, so scaling out does not steal another instance's connections. This is the mitigation already designed into the Week 3 flow. |
| **Scale-out** | Target-tracking on average CPU **> 65%** for 3 minutes, *or* a custom metric `MqttBacklogPerInstance` > 200 messages |
| **Scale-in** | CPU **< 30%** for 10 minutes (longer than scale-out to avoid flapping under bursty retail traffic) |
| **Ceiling** | Lab: `MAX_NODE_RED_INSTANCES = 2`. Production target: 6, tuned after load testing |
| **Heavy work** | Keep transformation light in Node-RED; hand off to SQS as soon as the payload is normalised |

### 4.3 Amazon SQS (event buffer)

Breaking point: consumers lag a producer burst, so replenishment is delayed. SQS is also NFR3 (redelivery, no lost orders).

Three queues, one per hop, so each service scales on its own backlog:

1. `sales-events` — Node-RED → Forecasting
2. `forecast-ready` — Forecasting → Replenishment Decision
3. `replenishment-approved` — Decision → Order Dispatch

| | |
|---|---|
| **Scale-out trigger** | `ApproximateNumberOfMessagesVisible` **> 500** for 2 minutes (tune per queue) |
| **Action** | Application Auto Scaling target-tracking on the *consuming* Lambda’s reserved concurrency — queue depth drives compute, not just CPU |
| **DLQ** | One DLQ per queue, `maxReceiveCount = 3` — poison messages cannot block the pipeline (mitigation) |
| **Visibility timeout** | 6× p99 of the consuming Lambda (measured in Week 7), so in-flight work is not redelivered |
| **Batching** | Event-source mapping batch size 10; `ReportBatchItemFailures` enabled so one bad record does not retry the whole batch |

Until these queues replace the current direct-call demo (`microservices/run-pipeline-demo.js`), this policy cannot be proven. Completing the Week 5 SQS wiring is a prerequisite for Week 7.

### 4.4 AWS Lambda (Forecasting, Replenishment Decision, Order Dispatch)

Breaking point: default concurrency (typically 1,000; often much lower in Academy labs) is exhausted and invocations are throttled.

| | Lab (Learner Lab) | Production target |
|---|---|---|
| **Reserved concurrency — Forecasting** | 30 | 300 |
| **Reserved concurrency — Replenishment Decision** | 30 | 300 |
| **Reserved concurrency — Order Dispatch** | 20 | 200 |
| **Provisioned concurrency** | Decision only, 5 (cold-start sensitive path) | Decision only, ~20% of reserved (60) |
| **Account-limit alarm** | `ConcurrentExecutions` > 70% of the *observed* lab quota | Same, then request a Service Quota increase |
| **Throttle alarm** | `Throttles` > 0 for 1 minute | Same |
| **Backpressure** | Services are invoked **only** from SQS, never synchronously from Node-RED | Same |

Reserved concurrency does two jobs: it guarantees each service a floor during a spike (NFR6 — one busy path cannot starve the others) and it is the hard ceiling that protects the lab budget.

Replenishment Decision is the only function with provisioned concurrency because a cold start on that path delays a real supplier order (NFR2).

### 4.5 DynamoDB (StockLevels, SalesEvents, ForecastResults)

Breaking point: `store_id` as the only key creates a hot partition. The adapters already use `store_id#sku_id` (`store_id_sku_id` in `createDynamoDbStore`).

| Table | Key | Role |
|---|---|---|
| StockLevels | `store_id#sku_id` | Live quantity, last-updated, reorder threshold |
| SalesEvents | `store_id#sku_id` + timestamp | Append-only window for forecasting (rolling 30 observations) |
| ForecastResults | `store_id#sku_id` | Latest forecast + confidence |

| | |
|---|---|
| **Capacity** | On-demand — throughput scales with load; no pre-provisioned RCU/WCU (NFR7) |
| **Watch** | `ThrottledRequests`, `ConsumedWriteCapacityUnits` per table |
| **Alarm** | `ThrottledRequests` > 0 sustained for 2 minutes |
| **Interpretation** | Under on-demand, sustained throttling is a **partition-key design problem**, not a “add capacity” problem. Investigate hot keys; do not “fix” it by switching to provisioned mode. |
| **Adaptive capacity** | On by default in on-demand — secondary safety net for a single hot SKU |

S3 (historical CSVs / model artefacts) and optional Aurora for supplier/order records are not expected breaking points at 20–50 simulated stores. If Aurora is used, enable Aurora Serverless v2 with ACUs scaling on CPU; otherwise keep Orders in DynamoDB for the lab.

### 4.6 Kinesis (optional shared event bus)

Listed Kinesis/SQS as alternatives. The default path is SQS (simpler event-source mapping to Lambda). If a Kinesis stream is added for the high-volume sensor firehose:

| | |
|---|---|
| **Mode** | On-demand (shards scale automatically) |
| **Alarms** | `IteratorAgeMilliseconds` > 30,000 ms; `WriteProvisionedThroughputExceeded` > 0 |
| **Action** | Investigate consumer lag first; only then increase parallelism (`ParallelizationFactor`) on the Lambda event source |

## 5. Consolidated alarm table (Week 7 must exercise each row)

| CloudWatch metric | Threshold | Component | Action |
|---|---|---|---|
| `CPUUtilization` | > 65% for 3 min | Node-RED ECS/EC2 | Scale out +1 instance, up to ceiling |
| `CPUUtilization` | < 30% for 10 min | Node-RED ECS/EC2 | Scale in −1 instance, down to 1 |
| `ConcurrentExecutions` | > 70% of account/lab quota | Lambda (all three) | Alert; do not keep raising load blindly |
| `Throttles` | > 0 for 1 min | Lambda | Confirm reserved concurrency / SQS buffer |
| `ApproximateNumberOfMessagesVisible` | > 500 for 2 min | Each SQS queue | Raise consumer reserved concurrency |
| `ApproximateAgeOfOldestMessage` | > 60 s | Each SQS queue | Same — decisions are becoming late (NFR2) |
| `ThrottledRequests` | > 0 sustained | DynamoDB tables | Investigate hot partition, not add RCU |
| `Connect.Throttle` / `PublishIn.Throttle` | > 0 for 2 min | IoT Core | Reduce Thing/connection count |
| `IteratorAgeMilliseconds` | > 30,000 ms | Kinesis (if used) | Scale consumer parallelism |

Billing alarm from Week 1 environment setup stays in place as the cost backstop (risk: free-tier / account limits).

## Future test procedure
Section 2.4 and the project-plan risk (“test at 20–50 simulated stores, then extrapolate”).

1. **Baseline traffic** — current simulator: 5 stores × 10 SKUs. Record Node-RED CPU, Lambda `Duration`/`Throttles`/`ConcurrentExecutions`, SQS depth/age, DynamoDB `ConsumedWriteCapacityUnits`.
2. **Ramp without scaling policies** — Artillery or k6 (or extra controller processes) from 5 → 20 → 50 stores. Hold each step 5 minutes. Confirm each breaking point is *reproducible* (Node-RED CPU climb, Lambda throttle, or queue age growth). Stop a ramp early if the lab quota is hit — record the observed quota; that *is* evidence.
3. **Enable policies** in Section 4. Re-run the same ramp.
4. **Before/after comparison** for the final report: p99 forecast-to-order latency, error/throttle count, max SQS age, whether a replenishment still completes within minutes (NFR2).
5. **Chaos (NFR3)** — stop the Decision Lambda mid-flow; confirm SQS redelivery completes the order and the DLQ only receives true poison messages.
6. **Tune** thresholds from what was actually observed. The numbers in Section 4 are starting points.

Learner Lab sessions expire after ~4 hours and credentials rotate. The ramp, both runs, and screenshots must fit in one session. Keep infrastructure scripted (CLI/CloudFormation notes in the repo) so a lab reset does not wipe the experiment.

## 7. AWS Academy Learner Lab constraints

The status update records that access is a Canvas Learner Lab (LabRole, ~4-hour sessions, no custom IAM users). That changes *how* policies are applied, not *what* they are:

| Constraint | Effect on this plan |
|---|---|
| No custom IAM roles | Use LabRole / lab-allowed service roles; avoid designs that need a new role per function if the lab forbids it |
| Quota increases may be blocked | Do not depend on raising the 1,000 concurrency story. Measure the *actual* lab quota in step 2 and treat 70% of *that* as the alarm |
| Resources reset between sessions | Document every alarm, queue, and table in the repo; re-apply at the start of the Week 7 session |
| Budget / free-tier risk | Hard ceilings in Section 4; existing billing alarm; 20–50 store cap |

If a lab control cannot be created (for example ECS Auto Scaling), record that as a lab limitation and still demonstrate the **metric and threshold** (alarm + screenshot) plus a manual scale-out of a second Node-RED process. The Distinction requirement is evidence that the breaking point is understood and mitigated, not that every AWS product is available in Academy.

## 8. Cost guardrails (NFR7)

- Hard `MAX_NODE_RED_INSTANCES` and Lambda reserved-concurrency caps.
- On-demand DynamoDB and SQS are pay-per-use; exposure is bounded by the 50-store test cap.
- Provisioned concurrency is limited to Replenishment Decision only.
- Billing alarm remains the last backstop.

## 9. Out of scope 

- Multi-region failover.
- Predictive/scheduled scaling before a known promotion (a later extension once reactive policies are proven).
- Replacing exponential smoothing with Prophet/SageMaker — forecasting method is independent of these scaling policies.

