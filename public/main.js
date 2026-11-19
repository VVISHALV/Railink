const form = document.getElementById("search-form");
const outputEl = document.getElementById("output");
const directEl = document.getElementById("direct");
const stitchedEl = document.getElementById("stitched");
const boardingSelect = document.getElementById("boarding-select");
const destinationSelect = document.getElementById("destination-select");
const classSelect = document.getElementById("class-select");
const chartTypeSelect = document.getElementById("chart-type-select");
const remoteStationSelect = document.getElementById("remote-station-select");
const feedbackForm = document.getElementById("feedback-form");
const feedbackInput = document.getElementById("feedback-input");
const feedbackStatus = document.getElementById("feedback-status");
const VACANCY_NOTE = "Vacancy status shown here is based on the last chart preparation and may change in real time.";

// Info button toggle functionality
const infoBtnContainer = document.querySelector(".what-is-info");
const infoBtn = document.querySelector(".info-btn");
if (infoBtn) {
  // Toggle tooltip on button click
  infoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    infoBtn.classList.toggle("active");
  });
  
  // Close tooltip when clicking outside
  document.addEventListener("click", (e) => {
    if (!infoBtnContainer.contains(e.target)) {
      infoBtn.classList.remove("active");
    }
  });
}

const dateInput = form.querySelector('input[name="jDate"]');
if (!dateInput.value) {
  dateInput.value = new Date().toISOString().slice(0, 10);
}

let loadedStations = [];
let loadedChartOptions = [];
let loadedRemoteStations = [];
let loadedChartOptionsByRemote = {};
let trainBootstrapTimer = null;

const trainNoInput = form.querySelector('input[name="trainNo"]');

trainNoInput.addEventListener("blur", scheduleTrainBootstrapLoad);

async function loadTrainBootstrap() {
  const trainNo = trainNoInput.value.trim();
  const jDate = dateInput.value;

  if (!trainNo || !jDate) {
    resetTrainBootstrapState();
    return;
  }

  renderLoading("Loading stations and classes...");

  try {
    const response = await fetch("/api/train-bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trainNo, jDate })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to load train data");

    loadedStations = Array.isArray(data.stations) ? data.stations : [];
    loadedChartOptions = normalizeChartOptions(data.chartOptions);
    loadedRemoteStations = normalizeRemoteStations(data.remoteStations);
    loadedChartOptionsByRemote = normalizeRemoteChartOptionsByStation(data.remoteChartOptionsByStation);
    populateStationSelects(loadedStations, data.sourceStation, data.destinationStation);
    populateClassSelect(classSelect, data.classCodes || []);
    populateRemoteStationSelect(remoteStationSelect, loadedRemoteStations, data.sourceStation);
    syncChartTypeOptionsForSelectedRemote();

    hideOutput();
  } catch (error) {
    resetTrainBootstrapState();
    renderError(error.message || "Failed to load train data");
  }
}

function scheduleTrainBootstrapLoad() {
  if (trainBootstrapTimer) {
    clearTimeout(trainBootstrapTimer);
  }

  trainBootstrapTimer = setTimeout(() => {
    trainBootstrapTimer = null;
    loadTrainBootstrap();
  }, 350);
}

function resetTrainBootstrapState() {
  loadedStations = [];
  loadedChartOptions = [];
  loadedRemoteStations = [];
  loadedChartOptionsByRemote = {};
  resetSelect(boardingSelect, "Enter train number and date");
  resetSelect(destinationSelect, "Enter train number and date");
  resetSelect(classSelect, "Enter train number and date");
  resetSelect(chartTypeSelect, "Enter train number and date");
  resetSelect(remoteStationSelect, "Enter train number and date");
}

boardingSelect.addEventListener("change", () => {
  syncDestinationOptions();
});

remoteStationSelect.addEventListener("change", () => {
  syncChartTypeOptionsForSelectedRemote();
});

if (feedbackForm) {
  feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const feedback = (feedbackInput?.value || "").trim();
    if (!feedback) {
      setFeedbackStatus("Please enter feedback before submitting.", true);
      return;
    }

    setFeedbackStatus("Sending feedback...", false);

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedback })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to submit feedback");
      }

      feedbackForm.reset();
      setFeedbackStatus("Thanks! Feedback submitted.", false);
    } catch (error) {
      setFeedbackStatus(error.message || "Failed to submit feedback", true);
    }
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  directEl.innerHTML = "";
  stitchedEl.innerHTML = "";

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  if (!loadedStations.length) {
    renderError("Load train stations/classes before analyzing.");
    return;
  }

  payload.source = boardingSelect.value;
  payload.destination = destinationSelect.value;
  payload.cls = classSelect.value;
  payload.chartType = chartTypeSelect.value;
  payload.remoteStation = remoteStationSelect.value;

  renderLoading("Analyzing vacancy...");

  try {
    const response = await fetch("/api/vacancy-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    renderResult(data);
  } catch (error) {
    renderError(error.message || "Request failed");
  }
});

function populateStationSelects(stations, sourceStation, destinationStation) {
  resetSelect(boardingSelect, "Select from station", false);
  resetSelect(destinationSelect, "Select destination station", false);

  stations.forEach((station) => {
    const label = `${station.code} - ${station.name}`;
    const boardingOpt = new Option(label, station.code);
    boardingSelect.add(boardingOpt);
  });

  boardingSelect.disabled = false;
  destinationSelect.disabled = false;
  boardingSelect.value = sourceStation || "";

  syncDestinationOptions(destinationStation);
}

function syncDestinationOptions(preferredDestination) {
  const currentBoarding = boardingSelect.value;
  const startIndex = loadedStations.findIndex((s) => s.code === currentBoarding);

  resetSelect(destinationSelect, "Select destination station", false);

  loadedStations.forEach((station, idx) => {
    if (idx <= startIndex) return;
    const label = `${station.code} - ${station.name}`;
    destinationSelect.add(new Option(label, station.code));
  });

  if (preferredDestination && Array.from(destinationSelect.options).some((o) => o.value === preferredDestination)) {
    destinationSelect.value = preferredDestination;
  } else if (destinationSelect.options.length > 1) {
    destinationSelect.selectedIndex = 1;
  }
}

function populateClassSelect(selectEl, classCodes) {
  resetSelect(selectEl, "Select class", false);

  classCodes.forEach((code) => {
    selectEl.add(new Option(code, code));
  });

  selectEl.disabled = classCodes.length === 0;
  if (classCodes.length) {
    selectEl.value = classCodes.includes("SL") ? "SL" : classCodes[0];
  }
}

function populateChartTypeSelect(selectEl, chartOptions) {
  resetSelect(selectEl, "Select chart type", false);

  chartOptions.forEach((option) => {
    const dateLabel = option.chartDate
      ? new Date(option.chartDate).toLocaleString()
      : "Date unavailable";
    selectEl.add(new Option(`Chart ${option.chartType} (${dateLabel})`, String(option.chartType)));
  });

  selectEl.disabled = chartOptions.length === 0;

  if (!chartOptions.length) {
    return;
  }

  selectEl.value = String(getLatestChartType(chartOptions));
}

function populateRemoteStationSelect(selectEl, remoteStations, sourceStation) {
  resetSelect(selectEl, "Select remote station", false);

  const options = remoteStations.length
    ? remoteStations
    : (sourceStation ? [String(sourceStation).toUpperCase()] : []);

  options.forEach((stationCode) => {
    selectEl.add(new Option(stationCode, stationCode));
  });

  selectEl.disabled = options.length === 0;
  if (options.length) {
    selectEl.value = options[0];
  }
}

function syncChartTypeOptionsForSelectedRemote() {
  const selectedRemote = String(remoteStationSelect?.value || "").toUpperCase();
  const optionsForRemote = selectedRemote
    ? (loadedChartOptionsByRemote[selectedRemote] || [])
    : [];
  const effectiveOptions = optionsForRemote.length ? optionsForRemote : loadedChartOptions;
  populateChartTypeSelect(chartTypeSelect, effectiveOptions);
}

function normalizeChartOptions(incomingOptions) {
  const normalized = (Array.isArray(incomingOptions) ? incomingOptions : [])
    .map((option) => {
      const chartType = Number(option?.chartType);
      if (!Number.isFinite(chartType) || chartType <= 0) {
        return null;
      }

      return {
        chartType,
        chartDate: option?.chartDate || null
      };
    })
    .filter(Boolean);

  return normalized;
}

function normalizeRemoteStations(incomingStations) {
  const seen = new Set();
  const normalized = [];

  for (const station of Array.isArray(incomingStations) ? incomingStations : []) {
    const code = String(station || "").trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    normalized.push(code);
  }

  return normalized;
}

function normalizeRemoteChartOptionsByStation(incomingMap) {
  const normalizedMap = {};

  if (incomingMap == null || typeof incomingMap !== "object") {
    return normalizedMap;
  }

  for (const [station, chartOptions] of Object.entries(incomingMap)) {
    const stationCode = String(station || "").trim().toUpperCase();
    if (!stationCode) continue;
    normalizedMap[stationCode] = normalizeChartOptions(chartOptions);
  }

  return normalizedMap;
}

function getLatestChartType(chartOptions) {
  if (chartOptions.some((option) => Number(option.chartType) === 2)) {
    return 2;
  }

  return chartOptions
    .map((option) => Number(option.chartType))
    .filter((chartType) => Number.isFinite(chartType) && chartType > 0)
    .sort((a, b) => b - a)[0] || 1;
}

function resetSelect(selectEl, placeholder, disable = true) {
  selectEl.innerHTML = "";
  selectEl.add(new Option(placeholder, ""));
  selectEl.disabled = disable;
}

function renderResult(data) {
  showOutput();

  const summary = data.summary || {};
  const journeyStations = data.journeyStations || [];
  const vacancyWindows = data.vacancyWindows || [];
  const stitched = data.stitchedPlan || {};
  const segments = Array.isArray(stitched.segments) ? stitched.segments : [];

  directEl.innerHTML = buildTimelineHTML(journeyStations, vacancyWindows, data.journeyStartIndex || 0);
  attachTimelineHover();

  const selectedChartType = Number(chartTypeSelect?.value);
  const selectedRemote = String(remoteStationSelect?.value || "").toUpperCase();
  const chartOptionsForRemote = loadedChartOptionsByRemote[selectedRemote] || loadedChartOptions;
  const selectedChart = chartOptionsForRemote.find((option) => option.chartType === selectedChartType) || null;
  const chartDateText = selectedChart?.chartDate ? ` (Chart prepared: ${new Date(selectedChart.chartDate).toLocaleString()})` : '';
  stitchedEl.innerHTML = `
    <p class="stitched-note">${VACANCY_NOTE}${chartDateText}</p>
    <div class="card stitched-card ${stitched.fullyCovered ? 'is-coverable' : 'is-not-coverable'}">
      <div class="stitched-head">
        <h3>Stitched Journey Plan</h3>
        <span class="stitched-state ${stitched.fullyCovered ? 'good' : 'bad'}">${stitched.fullyCovered ? 'Coverable' : 'Not Coverable'}</span>
      </div>
      <div class="stitched-kpis">
        <div class="stitched-kpi">
          <span class="stitched-kpi-value">${segments.length}</span>
          <small>Segments</small>
        </div>
        <div class="stitched-kpi">
          <span class="stitched-kpi-value">${summary.seatChangeCount ?? 0}</span>
          <small>Seat Changes</small>
        </div>
        <div class="stitched-kpi">
          <span class="stitched-kpi-value">${summary.directSeatCount ?? 0}</span>
          <small>Direct Seats</small>
        </div>
      </div>
      ${
        stitched.fullyCovered && segments.length
          ? `<div class="stitched-route">${segments
              .map((s) =>
                `<div class="stitched-segment">
                   <div class="stitched-leg">${s.fromStation} <span>to</span> ${s.toStation}</div>
                   <div class="stitched-seat">Seat ${s.seat}</div>
                 </div>`
              )
              .join('<span class="stitched-arrow">→</span>')}</div>`
          : '<p class="stitched-empty">No complete stitched plan available for the selected journey.</p>'
      }
    </div>

  `;
}

function renderLoading(message) {
  showOutput();
  directEl.innerHTML = "";
  stitchedEl.innerHTML = `
    <div class="card stitched-card loading-card">
      <div class="loading-row">
        <span class="spinner" aria-hidden="true"></span>
        <div>
          <h3>${message || "Loading..."}</h3>
          <p class="stitched-empty">Please wait while we fetch the latest data.</p>
        </div>
      </div>
    </div>
  `;
}

function renderError(message) {
  showOutput();
  directEl.innerHTML = "";
  stitchedEl.innerHTML = `
    <div class="card stitched-card is-not-coverable">
      <div class="stitched-head">
        <h3>Unable to load vacancy data</h3>
        <span class="stitched-state bad">Error</span>
      </div>
      <p class="stitched-empty">${message || "Request failed"}</p>
    </div>
  `;
}

function showOutput() {
  if (outputEl) {
    outputEl.hidden = false;
  }
}

function hideOutput() {
  if (outputEl) {
    outputEl.hidden = true;
  }
}

function setFeedbackStatus(message, isError) {
  if (!feedbackStatus) return;
  feedbackStatus.textContent = message || "";
  feedbackStatus.classList.toggle("error", Boolean(isError));
}

// Segment seat data stored here for hover access
let _tlSegmentData = [];

function buildTimelineHTML(stations, windows, startIndex) {
  if (!stations.length) return '<div class="card"><p>No journey stations to display.</p></div>';

  _tlSegmentData = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const absI = startIndex + i;
    _tlSegmentData.push({
      from: stations[i],
      to: stations[i + 1],
      seats: windows.filter(w => w.fromIndex <= absI && w.toIndex > absI)
        .map(w => ({ coach: w.coach, berth: w.berth, berthCode: w.berthCode }))
    });
  }

  function segColor(count) {
    if (count === 0) return '#f44336';
    if (count < 4) return '#ff9800';
    return '#4caf50';
  }

  const stationNodes = stations.map((s, i) => `
    <div class="tl-station">
      <div class="tl-label">${s.code}<br><span>${s.name.split(' ').slice(0, 2).join(' ')}</span></div>
      <div class="tl-node"></div>
    </div>
  `);

  const segmentNodes = _tlSegmentData.map((seg, i) => {
    const count = seg.seats.length;
    return `
      <div class="tl-segment" data-seg="${i}" style="--seg-color: ${segColor(count)}">
        <div class="tl-seg-bar"></div>
        <div class="tl-seg-count">${count}</div>
      </div>
    `;
  });

  let cells = '';
  for (let i = 0; i < stations.length; i++) {
    cells += stationNodes[i];
    if (i < _tlSegmentData.length) cells += segmentNodes[i];
  }

  return `
    <div class="card">
      <h3>Vacancy Timeline</h3>
      <p class="sub">Hover or click a segment bar to see available seats.</p>
      <div class="legend">
        <span class="leg red"></span> No seats &nbsp;
        <span class="leg yellow"></span> Few (&lt;4) &nbsp;
        <span class="leg green"></span> Available
      </div>
      <div class="timeline-wrap">
        <div class="timeline" id="tl-root">${cells}</div>
      </div>
      <div id="tl-detail" class="tl-detail" style="display:none"></div>
    </div>
  `;
}

function attachTimelineHover() {
  const root = document.getElementById('tl-root');
  const detail = document.getElementById('tl-detail');
  if (!root || !detail) return;

  root.querySelectorAll('.tl-segment').forEach(seg => {
    seg.addEventListener('mouseenter', () => {
      const i = parseInt(seg.dataset.seg, 10);
      const d = _tlSegmentData[i];
      if (!d) return;

      // highlight active segment
      root.querySelectorAll('.tl-segment').forEach(s => s.classList.remove('active'));
      seg.classList.add('active');

      const rows = d.seats.map(s =>
        `<tr><td>${s.coach}</td><td>${s.berth}</td><td>${s.berthCode || '-'}</td></tr>`
      ).join('');

      detail.style.display = 'block';
      detail.innerHTML = `
        <div class="tl-detail-header">
          <strong>${d.from.code} → ${d.to.code}</strong>
          <span>${d.seats.length} seat(s) available</span>
        </div>
        ${d.seats.length
          ? `<div class="tl-detail-scroll">
               <table class="seat-table">
                 <thead><tr><th>Coach</th><th>Berth</th><th>Type</th></tr></thead>
                 <tbody>${rows}</tbody>
               </table>
             </div>`
          : '<p style="padding:8px 0;color:#888">No seats available for this segment.</p>'
        }
      `;
    });
  });
}
