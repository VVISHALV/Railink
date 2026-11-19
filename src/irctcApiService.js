const fetch = require("node-fetch");

const IRCTC_SCHEDULE_URL = "https://www.irctc.co.in/eticketing/protected/mapps1/trnscheduleenquiry";
const IRCTC_VACANT_BERTH_URL = "https://www.irctc.co.in/online-charts/api/vacantBerth";
const IRCTC_TRAIN_COMPOSITION_URL = "https://www.irctc.co.in/online-charts/api/trainComposition";

function scheduleHeaders() {
  return {
    accept: "*/*",
    "cache-control": "no-cache",
    "user-agent": "PostmanRuntime/7.54.0",
    "accept-encoding": "",
    greq: String(Date.now())
  };
}

function vacancyHeaders() {
  return {
    accept: "*/*",
    "cache-control": "no-cache",
    "user-agent": "PostmanRuntime/7.54.0",
    "accept-encoding": "",
    "content-type": "application/json"
  };
}

function compositionHeaders() {
  return {
    accept: "*/*",
    "cache-control": "no-cache",
    "user-agent": "PostmanRuntime/7.54.0",
    "accept-encoding": "",
    "content-type": "application/json",
    greq: String(Date.now())
  };
}

async function requestJson(url, options = {}, timeoutMs = 20000) {
  const apiName = getIrctcApiName(url);
  const method = String(options.method || "GET").toUpperCase();
  const resolvedHeaders = resolveRequestHeaders(url, options);

  logIrctcRequest(apiName, {
    url,
    method,
    headers: resolvedHeaders,
    bodyPreview: previewData(options.body)
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let parsed;

    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { rawText: text };
    }

    if (!response.ok) {
      logIrctcError(apiName, {
        stage: "upstream-http-error",
        url,
        method,
        status: response.status,
        requestHeaders: resolvedHeaders,
        responsePreview: previewData(parsed)
      });

      const err = new Error(`HTTP ${response.status}: ${JSON.stringify(parsed).slice(0, 500)}`);
      err.status = response.status;
      err.url = url;
      err.responsePreview = JSON.stringify(parsed).slice(0, 1000);
      throw err;
    }

    return parsed;
  } catch (error) {
    if (!error.status) {
      logIrctcError(apiName, {
        stage: "upstream-network-error",
        url,
        method,
        requestHeaders: resolvedHeaders,
        error: error.message
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getTrainScheduleResponse(trainNo) {
  const url = `${IRCTC_SCHEDULE_URL}/${trainNo}`;
  const response = await requestJson(url, {
    method: "GET",
    headers: scheduleHeaders()
  });

  logIrctcResponse("schedule", {
    url,
    request: { trainNo: String(trainNo) },
    response
  });

  return fetchIrctcPayload(
    () => Promise.resolve(response),
    "IRCTC response error. Try later.",
    url
  );
}

async function getVacantBerthResponse(payload) {
  const response = await requestJson(IRCTC_VACANT_BERTH_URL, {
    method: "POST",
    headers: vacancyHeaders(),
    body: JSON.stringify(payload)
  });

  logIrctcResponse("vacantBerth", {
    url: IRCTC_VACANT_BERTH_URL,
    request: payload,
    response
  });

  return fetchIrctcPayload(
    () => Promise.resolve(response),
    "Chart not prepared",
    IRCTC_VACANT_BERTH_URL
  );
}

async function getTrainCompositionResponse(payload) {
  const response = await requestJson(IRCTC_TRAIN_COMPOSITION_URL, {
    method: "POST",
    headers: compositionHeaders(),
    body: JSON.stringify(payload)
  });

  logIrctcResponse("trainComposition", {
    url: IRCTC_TRAIN_COMPOSITION_URL,
    request: payload,
    response
  });

  return fetchIrctcPayload(
    () => Promise.resolve(response),
    "Chart not prepared",
    IRCTC_TRAIN_COMPOSITION_URL
  );
}

async function fetchIrctcPayload(fetcher, message, url) {
  const apiName = getIrctcApiName(url);

  try {
    const data = await fetcher();

    if (isInvalidIrctcPayload(data)) {
      logIrctcError(apiName, {
        stage: "invalid-payload",
        url,
        responsePreview: previewData(data)
      });

      throw createUpstreamError(message, {
        url,
        responsePreview: previewData(data)
      });
    }

    return data;
  } catch (error) {
    logIrctcError(apiName, {
      stage: "normalized-upstream-error",
      url: error?.url || url,
      status: error?.status || 502,
      responsePreview: error?.responsePreview || null,
      error: error?.message || "Unknown upstream error"
    });

    throw normalizeUpstreamError(error, message, url);
  }
}

function isInvalidIrctcPayload(data) {
  return data == null || typeof data !== "object" || Object.prototype.hasOwnProperty.call(data, "rawText");
}

function createUpstreamError(message, details = {}) {
  const error = new Error(message);
  error.status = details.status || 502;
  error.url = details.url || null;
  error.responsePreview = details.responsePreview || null;
  return error;
}

function normalizeUpstreamError(error, message, url) {
  if (error && error.message === message) {
    return error;
  }

  return createUpstreamError(message, {
    status: error?.status || 502,
    url: error?.url || url,
    responsePreview: error?.responsePreview || null
  });
}

function previewData(value) {
  try {
    return JSON.parse(JSON.stringify(value)).rawText
      ? String(value.rawText).slice(0, 700)
      : JSON.stringify(value).slice(0, 700);
  } catch {
    return String(value).slice(0, 700);
  }
}

function logIrctcResponse(apiName, details) {
  console.log(
    `[irctc:${apiName}]`,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      url: details.url,
      request: details.request,
      responsePreview: previewData(details.response)
    })
  );
}

function logIrctcRequest(apiName, details) {
  console.log(
    `[irctc:${apiName}:request]`,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      url: details.url,
      method: details.method,
      headers: details.headers,
      bodyPreview: details.bodyPreview
    })
  );
}

function logIrctcError(apiName, details) {
  console.error(
    `[irctc:${apiName}:error]`,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...details
    })
  );
}

function getIrctcApiName(url) {
  if (url.startsWith(IRCTC_SCHEDULE_URL)) return "schedule";
  if (url === IRCTC_VACANT_BERTH_URL) return "vacantBerth";
  if (url === IRCTC_TRAIN_COMPOSITION_URL) return "trainComposition";
  return "unknown";
}

function resolveRequestHeaders(url, options = {}) {
  const explicitHeaders = normalizeHeaders(options.headers);
  const method = String(options.method || "GET").toUpperCase();
  const body = options.body;

  const defaults = {
    accept: "*/*",
    "accept-encoding": "gzip,deflate",
    connection: "close",
    host: new URL(url).host,
    "user-agent": "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)"
  };

  if (body != null && !Object.prototype.hasOwnProperty.call(explicitHeaders, "content-length")) {
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    defaults["content-length"] = String(bodyBuffer.length);
  }

  return {
    ...defaults,
    ...explicitHeaders,
    ":method": method
  };
}

function normalizeHeaders(headers) {
  if (!headers) return {};

  if (Array.isArray(headers)) {
    return headers.reduce((acc, [key, value]) => {
      if (key) acc[String(key).toLowerCase()] = String(value);
      return acc;
    }, {});
  }

  return Object.entries(headers).reduce((acc, [key, value]) => {
    if (key && value != null) acc[String(key).toLowerCase()] = String(value);
    return acc;
  }, {});
}

module.exports = {
  getTrainScheduleResponse,
  getVacantBerthResponse,
  getTrainCompositionResponse
};