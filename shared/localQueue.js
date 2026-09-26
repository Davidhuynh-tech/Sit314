/**
 * In-process stand-in for Amazon SQS.
 * Messages use the same shape Lambda receives from an SQS event-source mapping
 * ({ messageId, receiptHandle, body, attributes }), with a per-queue dead-letter
 * queue after maxReceiveCount failed deliveries.
 */

function createLocalBus({ maxReceiveCount = 3 } = {}) {
  const queues = new Map();
  let seq = 0;

  function queue(name) {
    if (!queues.has(name)) queues.set(name, { messages: [], dlq: [], peak: 0 });
    return queues.get(name);
  }

  return {
    send(name, body) {
      const q = queue(name);
      const id = `msg-${++seq}`;
      q.messages.push({
        id,
        body: typeof body === "string" ? body : JSON.stringify(body),
        receives: 0,
        visibleAt: 0,
      });
      q.peak = Math.max(q.peak, q.messages.length);
      return id;
    },

    receive(name, max = 10) {
      const now = Date.now();
      const q = queue(name);
      const out = [];
      const remaining = [];

      for (const message of q.messages) {
        if (out.length >= max || message.visibleAt > now) {
          remaining.push(message);
          continue;
        }
        message.receives += 1;
        if (message.receives > maxReceiveCount) {
          q.dlq.push(message);
          continue;
        }
        message.visibleAt = Infinity;
        out.push(message);
        remaining.push(message);
      }

      q.messages = remaining;
      return out.map((message) => ({
        messageId: message.id,
        receiptHandle: message.id,
        body: message.body,
        attributes: { ApproximateReceiveCount: String(message.receives) },
      }));
    },

    delete(name, receiptHandle) {
      const q = queue(name);
      q.messages = q.messages.filter((message) => message.id !== receiptHandle);
    },

    nack(name, receiptHandle) {
      const q = queue(name);
      const message = q.messages.find((item) => item.id === receiptHandle);
      if (!message) return;
      if (message.receives >= maxReceiveCount) {
        q.messages = q.messages.filter((item) => item.id !== receiptHandle);
        q.dlq.push(message);
        return;
      }
      message.visibleAt = 0;
    },

    depth(name) {
      return queue(name).messages.length;
    },

    peak(name) {
      return queue(name).peak;
    },

    dlqDepth(name) {
      return queue(name).dlq.length;
    },
  };
}

const QUEUES = {
  sales: "sales-events",
  forecast: "forecast-ready",
  approved: "replenishment-approved",
};

module.exports = { createLocalBus, QUEUES };
