import {
  applyActions,
  autoArrange,
  calculateStats,
  createDefaultProject,
  moveElement
} from "./layout-engine.js";
import { blobToBase64, PushToTalkRecorder } from "./voice.js";

const elements = {
  roomWidth: document.querySelector("#room-width"),
  roomLength: document.querySelector("#room-length"),
  roomHeight: document.querySelector("#room-height"),
  rackCount: document.querySelector("#rack-count"),
  rackRows: document.querySelector("#rack-rows"),
  rackWidth: document.querySelector("#rack-width"),
  rackDepth: document.querySelector("#rack-depth"),
  rackPower: document.querySelector("#rack-power"),
  fanCount: document.querySelector("#fan-count"),
  fanWall: document.querySelector("#fan-wall"),
  fanWidth: document.querySelector("#fan-width"),
  fanAirflow: document.querySelector("#fan-airflow"),
  coldAisle: document.querySelector("#cold-aisle"),
  hotAisle: document.querySelector("#hot-aisle"),
  perimeter: document.querySelector("#perimeter"),
  applyButton: document.querySelector("#apply-settings"),
  optimizeButton: document.querySelector("#optimize-layout"),
  undoButton: document.querySelector("#undo"),
  redoButton: document.querySelector("#redo"),
  saveButton: document.querySelector("#save-json"),
  svg: document.querySelector("#layout-svg"),
  stats: document.querySelector("#stats"),
  warnings: document.querySelector("#warnings"),
  selected: document.querySelector("#selected-details"),
  commandInput: document.querySelector("#command-input"),
  sendCommand: document.querySelector("#send-command"),
  pushToTalk: document.querySelector("#push-to-talk"),
  voiceStatus: document.querySelector("#voice-status"),
  transcript: document.querySelector("#transcript"),
  assistantMessage: document.querySelector("#assistant-message"),
  history: document.querySelector("#command-history"),
  aiBadge: document.querySelector("#ai-badge")
};

let project = autoArrange(loadProject() || createDefaultProject());
let selectedId = null;
let past = [];
let future = [];
let dragging = null;
let busy = false;
const recorder = new PushToTalkRecorder();

initialize();

async function initialize() {
  bindEvents();
  syncForm();
  render();

  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    elements.aiBadge.textContent = health.aiConfigured ? "IA pronta" : "IA sem chave";
    elements.aiBadge.dataset.ready = String(Boolean(health.aiConfigured));
  } catch {
    elements.aiBadge.textContent = "Servidor indisponível";
    elements.aiBadge.dataset.ready = "false";
  }
}

function bindEvents() {
  elements.applyButton.addEventListener("click", applyManualSettings);
  elements.optimizeButton.addEventListener("click", () => {
    commitProject(autoArrange(project), "Layout reorganizado manualmente.");
  });
  elements.undoButton.addEventListener("click", undo);
  elements.redoButton.addEventListener("click", redo);
  elements.saveButton.addEventListener("click", saveJson);
  elements.sendCommand.addEventListener("click", () => submitCommand(elements.commandInput.value));
  elements.commandInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitCommand(elements.commandInput.value);
    }
  });

  elements.pushToTalk.addEventListener("pointerdown", startPushToTalk);
  window.addEventListener("pointerup", stopPushToTalk);
  window.addEventListener("pointercancel", cancelPushToTalk);

  elements.svg.addEventListener("pointerdown", startDrag);
  elements.svg.addEventListener("pointermove", dragElement);
  elements.svg.addEventListener("pointerup", finishDrag);
  elements.svg.addEventListener("pointercancel", finishDrag);
}

function applyManualSettings() {
  const actions = [
    {
      type: "set_room",
      widthM: numberValue(elements.roomWidth),
      lengthM: numberValue(elements.roomLength),
      heightM: numberValue(elements.roomHeight)
    },
    {
      type: "configure_racks",
      count: numberValue(elements.rackCount),
      rows: numberValue(elements.rackRows),
      widthM: numberValue(elements.rackWidth),
      depthM: numberValue(elements.rackDepth),
      powerKw: numberValue(elements.rackPower)
    },
    {
      type: "configure_fan_walls",
      count: numberValue(elements.fanCount),
      wall: elements.fanWall.value,
      widthM: numberValue(elements.fanWidth),
      airflowM3h: numberValue(elements.fanAirflow)
    },
    {
      type: "set_aisles",
      coldM: numberValue(elements.coldAisle),
      hotM: numberValue(elements.hotAisle),
      perimeterM: numberValue(elements.perimeter)
    }
  ];

  commitProject(applyActions(project, actions), "Parâmetros atualizados.");
}

async function startPushToTalk(event) {
  event.preventDefault();
  if (busy) return;

  try {
    await recorder.start();
    elements.pushToTalk.classList.add("recording");
    elements.pushToTalk.setPointerCapture?.(event.pointerId);
    setVoiceStatus("Gravando… solte para enviar", "recording");
  } catch (error) {
    setVoiceStatus(error.message, "error");
  }
}

async function stopPushToTalk() {
  if (!elements.pushToTalk.classList.contains("recording")) return;
  elements.pushToTalk.classList.remove("recording");

  try {
    setBusy(true);
    setVoiceStatus("Enviando áudio para transcrição…", "working");
    const blob = await recorder.stop();
    if (!blob || blob.size < 256) throw new Error("A gravação ficou muito curta.");

    const audioBase64 = await blobToBase64(blob);
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64, mimeType: blob.type })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Falha na transcrição.");

    elements.transcript.textContent = payload.text;
    setVoiceStatus("Transcrição concluída. Interpretando comando…", "working");
    await submitCommand(payload.text, { fromVoice: true });
  } catch (error) {
    setVoiceStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function cancelPushToTalk() {
  if (!elements.pushToTalk.classList.contains("recording")) return;
  recorder.cancel();
  elements.pushToTalk.classList.remove("recording");
  setVoiceStatus("Gravação cancelada.", "idle");
}

async function submitCommand(rawText, { fromVoice = false } = {}) {
  const text = String(rawText || "").trim();
  if (!text || busy) return;

  try {
    setBusy(true);
    elements.commandInput.value = "";
    if (!fromVoice) elements.transcript.textContent = text;
    setVoiceStatus("A IA está modelando o data hall…", "working");

    const response = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, project: projectForAi(project) })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Falha ao interpretar o comando.");

    const next = applyActions(project, payload.actions || []);
    commitProject(next, payload.message || "Comando aplicado.");
    elements.assistantMessage.textContent = payload.message || "Comando aplicado.";
    addCommandHistory(text, payload.message, payload.actions);
    setVoiceStatus("Concluído. Pressione e segure para falar novamente.", "success");
  } catch (error) {
    elements.assistantMessage.textContent = error.message;
    setVoiceStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

function commitProject(nextProject, message) {
  past.push(structuredClone(project));
  if (past.length > 50) past.shift();
  future = [];
  project = nextProject;
  persistProject();
  syncForm();
  render();
  if (message) elements.assistantMessage.textContent = message;
}

function undo() {
  const previous = past.pop();
  if (!previous) return;
  future.push(structuredClone(project));
  project = previous;
  persistProject();
  syncForm();
  render();
}

function redo() {
  const next = future.pop();
  if (!next) return;
  past.push(structuredClone(project));
  project = next;
  persistProject();
  syncForm();
  render();
}

function render() {
  renderLayout();
  renderStats();
  renderWarnings();
  renderSelected();
  elements.undoButton.disabled = past.length === 0;
  elements.redoButton.disabled = future.length === 0;
}

function renderLayout() {
  const margin = 0.8;
  elements.svg.setAttribute(
    "viewBox",
    `${-margin} ${-margin} ${project.room.widthM + margin * 2} ${project.room.lengthM + margin * 2}`
  );

  const grid = createGrid(project.room.widthM, project.room.lengthM);
  const room = `
    <rect class="room" x="0" y="0" width="${project.room.widthM}" height="${project.room.lengthM}" />
    <text class="room-label" x="0.2" y="-0.2">${format(project.room.widthM)} × ${format(project.room.lengthM)} × ${format(project.room.heightM)} m</text>
  `;

  const objects = project.elements
    .map((element) => {
      const selected = element.id === selectedId ? " selected" : "";
      const typeClass = element.type === "rack" ? "rack" : "fan-wall";
      const frontLine = element.type === "rack" ? rackFrontLine(element) : "";
      return `
        <g class="layout-element ${typeClass}${selected}" data-id="${element.id}">
          <rect x="${element.x}" y="${element.y}" width="${element.widthM}" height="${element.depthM}" rx="0.05" />
          ${frontLine}
          <text x="${element.x + element.widthM / 2}" y="${element.y + element.depthM / 2}" dominant-baseline="middle">${element.label}</text>
        </g>
      `;
    })
    .join("");

  elements.svg.innerHTML = `${grid}${room}${objects}`;
}

function createGrid(width, length) {
  const lines = [];
  for (let x = 0; x <= width; x += 1) {
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${length}" />`);
  }
  for (let y = 0; y <= length; y += 1) {
    lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" />`);
  }
  return `<g class="grid">${lines.join("")}</g>`;
}

function rackFrontLine(element) {
  const y = element.rotation === 180 ? element.y + 0.08 : element.y + element.depthM - 0.08;
  return `<line class="rack-front" x1="${element.x + 0.08}" y1="${y}" x2="${element.x + element.widthM - 0.08}" y2="${y}" />`;
}

function renderStats() {
  const stats = calculateStats(project);
  const items = [
    ["Racks", stats.rackCount],
    ["Fan walls", stats.fanWallCount],
    ["Potência de TI", `${format(stats.totalPowerKw, 0)} kW`],
    ["Vazão instalada", `${format(stats.totalAirflowM3h, 0)} m³/h`],
    ["Área da sala", `${format(stats.roomAreaM2)} m²`],
    ["Densidade", `${format(stats.densityKwM2)} kW/m²`],
    ["Ocupação dos racks", `${format(stats.occupiedPercent)}%`]
  ];
  elements.stats.innerHTML = items
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderWarnings() {
  elements.warnings.innerHTML = project.warnings.length
    ? project.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")
    : "<li class=\"ok\">Nenhum conflito geométrico básico.</li>";
}

function renderSelected() {
  const element = project.elements.find((item) => item.id === selectedId);
  if (!element) {
    elements.selected.textContent = "Selecione um rack ou fan wall na planta.";
    return;
  }

  elements.selected.innerHTML = `
    <strong>${element.label}</strong>
    <span>Tipo: ${element.type === "rack" ? "Rack" : "Fan wall"}</span>
    <span>Posição: X ${format(element.x)} m · Y ${format(element.y)} m</span>
    <span>Dimensão: ${format(element.widthM)} × ${format(element.depthM)} × ${format(element.heightM)} m</span>
    ${element.powerKw !== undefined ? `<span>Potência: ${format(element.powerKw)} kW</span>` : ""}
    ${element.airflowM3h !== undefined ? `<span>Vazão: ${format(element.airflowM3h, 0)} m³/h</span>` : ""}
  `;
}

function startDrag(event) {
  const group = event.target.closest?.("[data-id]");
  if (!group) {
    selectedId = null;
    render();
    return;
  }

  selectedId = group.dataset.id;
  const element = project.elements.find((item) => item.id === selectedId);
  if (!element) return;

  const point = svgPoint(event);
  dragging = {
    id: selectedId,
    offsetX: point.x - element.x,
    offsetY: point.y - element.y,
    original: structuredClone(project)
  };
  elements.svg.setPointerCapture?.(event.pointerId);
  render();
}

function dragElement(event) {
  if (!dragging) return;
  const point = svgPoint(event);
  project = moveElement(project, dragging.id, point.x - dragging.offsetX, point.y - dragging.offsetY);
  renderLayout();
  renderSelected();
}

function finishDrag() {
  if (!dragging) return;
  past.push(dragging.original);
  if (past.length > 50) past.shift();
  future = [];
  dragging = null;
  persistProject();
  render();
}

function svgPoint(event) {
  const point = elements.svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(elements.svg.getScreenCTM().inverse());
}

function syncForm() {
  setValue(elements.roomWidth, project.room.widthM);
  setValue(elements.roomLength, project.room.lengthM);
  setValue(elements.roomHeight, project.room.heightM);
  setValue(elements.rackCount, project.rackConfig.count);
  setValue(elements.rackRows, project.rackConfig.rows);
  setValue(elements.rackWidth, project.rackConfig.widthM);
  setValue(elements.rackDepth, project.rackConfig.depthM);
  setValue(elements.rackPower, project.rackConfig.powerKw);
  setValue(elements.fanCount, project.fanWallConfig.count);
  elements.fanWall.value = project.fanWallConfig.wall;
  setValue(elements.fanWidth, project.fanWallConfig.widthM);
  setValue(elements.fanAirflow, project.fanWallConfig.airflowM3h);
  setValue(elements.coldAisle, project.aisles.coldM);
  setValue(elements.hotAisle, project.aisles.hotM);
  setValue(elements.perimeter, project.aisles.perimeterM);
}

function addCommandHistory(command, message, actions) {
  const item = document.createElement("li");
  item.innerHTML = `
    <strong>${escapeHtml(command)}</strong>
    <span>${escapeHtml(message || "Comando aplicado.")}</span>
    <small>${escapeHtml((actions || []).map((action) => action.type).join(" · "))}</small>
  `;
  elements.history.prepend(item);
}

function saveJson() {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slug(project.name)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function projectForAi(value) {
  return {
    room: value.room,
    rackConfig: value.rackConfig,
    fanWallConfig: value.fanWallConfig,
    aisles: value.aisles,
    optimizationMode: value.optimizationMode,
    warnings: value.warnings
  };
}

function persistProject() {
  localStorage.setItem("cfd-web-project", JSON.stringify(project));
}

function loadProject() {
  try {
    const raw = localStorage.getItem("cfd-web-project");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setBusy(value) {
  busy = value;
  elements.pushToTalk.disabled = value;
  elements.sendCommand.disabled = value;
}

function setVoiceStatus(text, state) {
  elements.voiceStatus.textContent = text;
  elements.voiceStatus.dataset.state = state;
}

function numberValue(input) {
  return Number(input.value);
}

function setValue(input, value) {
  input.value = String(value);
}

function format(value, digits = 1) {
  return Number(value || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function slug(value) {
  return String(value || "data-hall")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
