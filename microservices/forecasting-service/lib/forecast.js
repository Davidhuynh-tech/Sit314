/**
 * Forecasting logic - Week 4 baseline per the Task 1 plan (Section 2.2):
 * a simple, explainable time-series method, with room to upgrade to
 * Prophet/SageMaker later if time allows.
 */

const DEFAULT_ALPHA = 0.3;

function movingAverage(history) {
  if (!history.length) return 0;
  return history.reduce((a, b) => a + b, 0) / history.length;
}

function exponentialSmoothing(history, alpha = DEFAULT_ALPHA) {
  if (!history.length) return 0;
  let s = history[0];
  for (let i = 1; i < history.length; i++) {
    s = alpha * history[i] + (1 - alpha) * s;
  }
  return s;
}

/**
 * @param {number[]} history - recent quantities sold/observed, oldest first
 * @returns {{forecastQuantity:number, movingAverage:number, method:string, alpha:number, confidence:string, sampleSize:number}}
 */
function computeForecast(history, alpha = DEFAULT_ALPHA) {
  if (!history || history.length === 0) {
    return { forecastQuantity: 0, movingAverage: 0, method: "none", alpha, confidence: "low", sampleSize: 0 };
  }
  const es = exponentialSmoothing(history, alpha);
  const ma = movingAverage(history);
  return {
    forecastQuantity: Math.round(es * 100) / 100,
    movingAverage: Math.round(ma * 100) / 100,
    method: "exponential_smoothing",
    alpha,
    // Confidence is a simple heuristic on sample size for now - Week 4+ can
    // replace this with a real prediction interval once more data exists.
    confidence: history.length >= 10 ? "high" : history.length >= 5 ? "medium" : "low",
    sampleSize: history.length,
  };
}

module.exports = { computeForecast, movingAverage, exponentialSmoothing, DEFAULT_ALPHA };
