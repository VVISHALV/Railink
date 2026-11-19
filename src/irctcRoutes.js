const express = require("express");
const {
  getTrainScheduleResponse,
  getVacantBerthResponse,
  getTrainCompositionResponse
} = require("./irctcApiService");

const router = express.Router();

const IRCTC_SCHEDULE_URL = "https://www.irctc.co.in/eticketing/protected/mapps1/trnscheduleenquiry";
const IRCTC_VACANT_BERTH_URL = "https://www.irctc.co.in/online-charts/api/vacantBerth";
const IRCTC_TRAIN_COMPOSITION_URL = "https://www.irctc.co.in/online-charts/api/trainComposition";
const SCHEDULE_RESPONSE_ERROR_MESSAGE = "IRCTC response error. Try later.";
const CHART_NOT_PREPARED_MESSAGE = "Chart not prepared";
const DEFAULT_CHART_TYPE = 1;

router.post("/api/train-bootstrap", async (req, res) => {
  try {
    const { trainNo, jDate, boardingStation } = req.body || {};

    if (!trainNo || !jDate) {
      return res.status(400).json({ error: "trainNo and jDate are required" });
    }

    const scheduleRaw = await getTrainScheduleResponse(trainNo);
    const stations = extractStationsFromSchedule(scheduleRaw);

    if (!stations.length) {
      throw createUpstreamError(SCHEDULE_RESPONSE_ERROR_MESSAGE, {
        url: `${IRCTC_SCHEDULE_URL}/${trainNo}`,
        responsePreview: previewData(scheduleRaw)
      });
    }

    const sourceStation = stations[0].code;
    const destinationStation = stations[stations.length - 1].code;
    const effectiveBoardingStation = String(boardingStation || sourceStation).toUpperCase();

    const compositionSeries = await fetchCompositionSeries({
      trainNo: String(trainNo),
      jDate,
      initialBoardingStation: effectiveBoardingStation
    });

    const classCodes = compositionSeries.classCodes;

    if (!classCodes.length) {
      throw createUpstreamError(CHART_NOT_PREPARED_MESSAGE, {
        url: IRCTC_TRAIN_COMPOSITION_URL,
        responsePreview: previewData(compositionSeries.lastCompositionResponse)
      });
    }

    const chartOptions = compositionSeries.chartOptions;

    return res.json({
      trainNo: String(trainNo),
      jDate,
      sourceStation,
      destinationStation,
      stations,
      classCodes,
      chartOptions,
      remoteStations: compositionSeries.remoteStations,
      remoteChartOptionsByStation: compositionSeries.remoteChartOptionsByStation
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message,
      upstreamStatus: error.status || null,
      upstreamUrl: error.url || null,
      upstreamResponsePreview: error.responsePreview || null
    });
  }
});

router.post("/api/vacancy-analysis", async (req, res) => {
  try {
    const {
      trainNo,
      source,
      destination,
      remoteStation,
      cls,
      jDate,
      chartType
    } = req.body || {};

    if (!trainNo || !source || !destination || !cls || !jDate) {
      return res.status(400).json({
        error: "trainNo, source, destination, cls, and jDate are required"
      });
    }

    const parsedChartType = Number(chartType);
    const resolvedChartType = Number.isFinite(parsedChartType) && parsedChartType > 0
      ? parsedChartType
      : DEFAULT_CHART_TYPE;

    const scheduleRaw = await getTrainScheduleResponse(trainNo);
    const stations = extractStationsFromSchedule(scheduleRaw);
    const sourceCode = String(source).toUpperCase();
    const destinationCode = String(destination).toUpperCase();

    if (!stations.length) {
      throw createUpstreamError(SCHEDULE_RESPONSE_ERROR_MESSAGE, {
        url: `${IRCTC_SCHEDULE_URL}/${trainNo}`,
        responsePreview: previewData(scheduleRaw)
      });
    }

    const normalizedStations = stations.map((s) => s.code.toUpperCase());
    const sourceIndex = normalizedStations.indexOf(sourceCode);
    const destinationIndex = normalizedStations.indexOf(destinationCode);

    if (sourceIndex === -1 || destinationIndex === -1 || sourceIndex >= destinationIndex) {
      return res.status(400).json({
        error: "Invalid source/destination for this train schedule",
        details: {
          sourceIndex,
          destinationIndex,
          availableStations: normalizedStations
        }
      });
    }

    const trainOrigin = normalizedStations[0];
    const resolvedRemoteStation = String(remoteStation || trainOrigin).toUpperCase();

    const payload = {
      trainNo: String(trainNo),
      boardingStation: trainOrigin,
      remoteStation: resolvedRemoteStation,
      trainSourceStation: trainOrigin,
      jDate,
      cls: String(cls).toUpperCase(),
      chartType: resolvedChartType
    };

    const vacancyRaw = await getVacantBerthResponse(payload);
    const berthWindows = extractVacancyWindows(vacancyRaw);

    if (!berthWindows.length && hasAnyKey(vacancyRaw, ["error", "message", "errorMessage"])) {
      throw createUpstreamError(CHART_NOT_PREPARED_MESSAGE, {
        url: IRCTC_VACANT_BERTH_URL,
        responsePreview: previewData(vacancyRaw)
      });
    }

    const indexedWindows = berthWindows
      .map((w) => {
        const fromIndex = normalizedStations.indexOf(w.from.toUpperCase());
        const toIndex = normalizedStations.indexOf(w.to.toUpperCase());
        return {
          ...w,
          fromIndex,
          toIndex
        };
      })
      .filter((w) => w.fromIndex !== -1 && w.toIndex !== -1 && w.fromIndex < w.toIndex);

    const directSeats = findDirectSeats(indexedWindows, sourceIndex, destinationIndex);
    const stitchedPlan = buildStitchedPlan(indexedWindows, sourceIndex, destinationIndex, stations);

    return res.json({
      message: "Fetched and parsed vacancy data",
      input: {
        trainNo: String(trainNo),
        source: sourceCode,
        destination: destinationCode,
        remoteStation: resolvedRemoteStation,
        cls: String(cls).toUpperCase(),
        jDate,
        chartType: resolvedChartType
      },
      summary: {
        totalWindowsParsed: indexedWindows.length,
        directSeatCount: directSeats.length,
        hasAnySegmentCoverage: stitchedPlan.hasAnyCoverage,
        journeyFullyCoverableBySeatChanges: stitchedPlan.fullyCovered,
        seatChangeCount: stitchedPlan.seatChangeCount || 0,
        rawVacancyError: vacancyRaw?.error || null
      },
      directSeats,
      stitchedPlan,
      vacancyWindows: indexedWindows,
      journeyStations: stations.slice(sourceIndex, destinationIndex + 1),
      journeyStartIndex: sourceIndex
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
});

function createUpstreamError(message, details = {}) {
  const error = new Error(message);
  error.status = details.status || 502;
  error.url = details.url || null;
  error.responsePreview = details.responsePreview || null;
  return error;
}

function extractStationsFromSchedule(scheduleData) {
  const candidates = findArrays(scheduleData, (arr) =>
    arr.some((item) => item && typeof item === "object" && hasAnyKey(item, ["stationCode", "stnCode", "station", "stationName"]))
  );

  const stationArray =
    candidates.find((arr) =>
      arr.some((item) => item && typeof item === "object" && hasAnyKey(item, ["stationCode", "stnCode"]))
    ) || [];

  const mapped = stationArray
    .map((item) => {
      const code =
        pick(item, ["stationCode", "stnCode", "station", "stn", "code"]) || "";
      const name = pick(item, ["stationName", "stnName", "name"]) || code;
      const seqRaw = pick(item, ["stationSerialNumber", "stnSerialNumber", "serialNumber", "sNo", "seq", "stopNumber"]);
      const seq = Number(seqRaw);

      return {
        code: String(code).trim().toUpperCase(),
        name: String(name).trim(),
        seq: Number.isFinite(seq) ? seq : null
      };
    })
    .filter((s) => s.code);

  return mapped.sort((a, b) => {
    if (a.seq == null && b.seq == null) return 0;
    if (a.seq == null) return 1;
    if (b.seq == null) return -1;
    return a.seq - b.seq;
  });
}

function extractVacancyWindows(vacancyData, requestedCoach) {
  const targetCoach = requestedCoach ? String(requestedCoach).toUpperCase() : null;

  const arrays = findArrays(vacancyData, (arr) =>
    arr.some((item) => item && typeof item === "object" && likelyVacancyObject(item))
  );

  const records = arrays.flat();

  return records
    .map((item) => {
      const coach = String(
        pick(item, ["coach", "coachNo", "coachNumber", "coachId", "coachCode", "coachName"]) || ""
      ).toUpperCase();
      const berth = String(
        pick(item, ["berth", "berthNo", "berthNumber", "seatNo", "seatNumber", "berthNum"]) || ""
      );
      const berthCode = String(pick(item, ["berthCode", "berthType"]) || "").toUpperCase();
      const cabinCoupeNo = String(pick(item, ["cabinCoupeNo", "cabNo", "coupeNo"]) || "");
      const from = String(
        pick(item, ["fromStnCode", "fromStation", "from", "boardingStation", "srcStnCode"]) || ""
      ).toUpperCase();
      const to = String(
        pick(item, ["toStnCode", "toStation", "to", "remoteStation", "destStnCode"]) || ""
      ).toUpperCase();

      return {
        coach,
        berth,
        berthCode,
        cabinCoupeNo,
        seatKey: `${coach}-${berth}${berthCode ? `-${berthCode}` : ""}`,
        from,
        to,
        status: String(pick(item, ["status", "berthStatus", "vacancyStatus"]) || "")
      };
    })
    .filter((r) => (!targetCoach || r.coach === targetCoach) && r.berth && r.from && r.to);
}

function extractClassCodesFromComposition(compositionData) {
  const classSet = new Set();
  const knownClassCodes = new Set(["1A", "2A", "3A", "3E", "CC", "EC", "EA", "SL", "2S", "FC", "VS", "VC", "EV", "GN"]);

  const objectArrays = findArrays(compositionData, (arr) =>
    arr.some((item) => item && typeof item === "object" && hasAnyKey(item, ["classCode", "journeyClass", "cls", "class"]))
  );

  for (const item of objectArrays.flat()) {
    const cls = String(pick(item, ["classCode", "journeyClass", "cls", "class"]) || "").toUpperCase().trim();
    if (!cls) continue;
    if (knownClassCodes.has(cls)) classSet.add(cls);
  }

  if (!classSet.size) {
    const stringArrays = findArrays(compositionData, (arr) => arr.some((item) => typeof item === "string"));
    for (const item of stringArrays.flat()) {
      const cls = String(item || "").toUpperCase().trim();
      if (knownClassCodes.has(cls)) classSet.add(cls);
    }
  }

  return Array.from(classSet).sort();
}

function extractAvailableChartTypes(compositionData) {
  const chartOptions = [];

  if (compositionData != null && typeof compositionData === "object") {
    const chartOneDate = compositionData.chartOneDate || null;
    const chartTwoDate = compositionData.chartTwoDate || null;

    if (chartOneDate) {
      chartOptions.push({ chartType: 1, chartDate: chartOneDate });
    }

    if (chartTwoDate) {
      chartOptions.push({ chartType: 2, chartDate: chartTwoDate });
    }
  }

  if (!chartOptions.length) {
    chartOptions.push({ chartType: DEFAULT_CHART_TYPE, chartDate: null });
  }

  return chartOptions;
}

async function fetchCompositionSeries({ trainNo, jDate, initialBoardingStation }) {
  const remoteStations = [];
  const classSet = new Set();
  const chartMap = new Map();
  const remoteChartOptionsByStation = {};
  let currentBoarding = String(initialBoardingStation || "").toUpperCase();
  let lastCompositionResponse = null;

  for (let hop = 0; hop < 30; hop += 1) {
    if (!currentBoarding) {
      break;
    }

    const compositionRaw = await getTrainCompositionResponse({
      trainNo,
      jDate,
      boardingStation: currentBoarding
    });

    lastCompositionResponse = compositionRaw;

    extractClassCodesFromComposition(compositionRaw).forEach((code) => classSet.add(code));
    const chartOptionsForResponse = extractAvailableChartTypes(compositionRaw);
    chartOptionsForResponse.forEach((option) => {
      chartMap.set(Number(option.chartType), option);
    });

    const remoteFromResponse = extractRemoteFromComposition(compositionRaw);
    const previousRemoteInList = remoteStations.length ? remoteStations[remoteStations.length - 1] : null;
    if (remoteFromResponse && remoteFromResponse !== previousRemoteInList) {
      remoteStations.push(remoteFromResponse);
      remoteChartOptionsByStation[remoteFromResponse] = chartOptionsForResponse;
    }

    if (!remoteFromResponse || remoteFromResponse === previousRemoteInList) {
      break;
    }

    const nextRemote = extractNextRemoteFromComposition(compositionRaw);
    if (!nextRemote) {
      break;
    }

    currentBoarding = nextRemote;
  }

  return {
    remoteStations,
    classCodes: Array.from(classSet).sort(),
    chartOptions: Array.from(chartMap.values()).sort((a, b) => Number(a.chartType) - Number(b.chartType)),
    remoteChartOptionsByStation,
    lastCompositionResponse
  };
}

function extractRemoteFromComposition(compositionData) {
  return findStringByKeys(compositionData, ["remote", "remoteStation"]);
}

function extractNextRemoteFromComposition(compositionData) {
  return findStringByKeys(compositionData, ["nextRemote"]);
}

function findStringByKeys(node, keys, depth = 0) {
  if (node == null || depth > 8) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const nested = findStringByKeys(item, keys, depth + 1);
      if (nested) return nested;
    }
    return null;
  }

  if (typeof node !== "object") {
    return null;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(node, key) && node[key] != null && node[key] !== "") {
      return String(node[key]).trim().toUpperCase();
    }
  }

  for (const value of Object.values(node)) {
    const nested = findStringByKeys(value, keys, depth + 1);
    if (nested) return nested;
  }

  return null;
}

function likelyVacancyObject(obj) {
  return (
    hasAnyKey(obj, ["berthNo", "berthNumber", "seatNo", "seatNumber", "berthNum"]) &&
    hasAnyKey(obj, ["coach", "coachNo", "coachNumber", "coachId", "coachCode", "coachName"]) &&
    hasAnyKey(obj, ["fromStnCode", "fromStation", "from"]) &&
    hasAnyKey(obj, ["toStnCode", "toStation", "to"])
  );
}

function findDirectSeats(windows, requestStart, requestEnd) {
  const map = new Map();

  for (const w of windows) {
    const seatKey = w.seatKey;
    if (!map.has(seatKey)) map.set(seatKey, []);
    map.get(seatKey).push(w);
  }

  const direct = [];
  for (const [seat, seatWindows] of map.entries()) {
    for (const w of seatWindows) {
      if (w.fromIndex <= requestStart && w.toIndex >= requestEnd) {
        direct.push({
          seat,
          coach: w.coach,
          berth: w.berth,
          berthCode: w.berthCode,
          coversFromIndex: w.fromIndex,
          coversToIndex: w.toIndex
        });
        break;
      }
    }
  }

  return direct;
}

function buildStitchedPlan(windows, requestStart, requestEnd, stations) {
  const legs = [];
  for (let i = requestStart; i < requestEnd; i += 1) {
    legs.push({
      fromIndex: i,
      toIndex: i + 1,
      fromStation: stations[i].code,
      toStation: stations[i + 1].code,
      seats: []
    });
  }

  for (const leg of legs) {
    const seatSet = new Set();

    for (const w of windows) {
      if (w.fromIndex <= leg.fromIndex && w.toIndex >= leg.toIndex) {
        seatSet.add(w.seatKey);
      }
    }

    leg.seats = Array.from(seatSet);
  }

  const uncoveredLegs = legs.filter((l) => l.seats.length === 0);
  if (uncoveredLegs.length) {
    return {
      hasAnyCoverage: legs.some((l) => l.seats.length > 0),
      fullyCovered: false,
      uncoveredLegs,
      segments: []
    };
  }

  const segments = [];
  let index = 0;

  while (index < legs.length) {
    const seatChoices = legs[index].seats;
    let bestSeat = seatChoices[0];
    let bestEnd = index + 1;

    for (const seat of seatChoices) {
      let end = index + 1;
      while (end < legs.length && legs[end].seats.includes(seat)) {
        end += 1;
      }
      if (end > bestEnd) {
        bestEnd = end;
        bestSeat = seat;
      }
    }

    segments.push({
      seat: bestSeat,
      fromStation: legs[index].fromStation,
      toStation: legs[bestEnd - 1].toStation,
      fromIndex: legs[index].fromIndex,
      toIndex: legs[bestEnd - 1].toIndex
    });

    index = bestEnd;
  }

  return {
    hasAnyCoverage: true,
    fullyCovered: true,
    uncoveredLegs: [],
    seatChangeCount: Math.max(segments.length - 1, 0),
    segments
  };
}

function findArrays(value, predicate) {
  const results = [];

  function walk(node, depth) {
    if (depth > 10 || node == null) return;

    if (Array.isArray(node)) {
      if (predicate(node)) results.push(node);
      for (const item of node) walk(item, depth + 1);
      return;
    }

    if (typeof node === "object") {
      for (const key of Object.keys(node)) {
        walk(node[key], depth + 1);
      }
    }
  }

  walk(value, 0);
  return results;
}

function hasAnyKey(obj, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function pick(obj, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== "") {
      return obj[key];
    }
  }
  return null;
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

module.exports = router;
