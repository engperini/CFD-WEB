import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import { z } from "zod";
import "./styles.css";
import {
  applyCommands,
  autoArrange,
  calculateStats,
  CURRENT_LAYOUT_RULES_VERSION,
  createDefaultProject,
  moveElement,
  normalizeProject,
  rotateElement,
  validateProject
} from "./shared/layoutEngine";
import type { DataHallElement, DataHallProject, StructuredCommand, Wall } from "./shared/types";
import { commandListSchema } from "./shared/commandSchemas";
import { blobToBase64, PushToTalkRecorder, type RecorderState } from "./hooks/usePushToTalk";

const STORAGE_KEY = "cfd-web-project-v2";
const recorder = new PushToTalkRecorder();

function App() {
  const [project, setProject] = useState<DataHallProject>(() => loadProject());
  const [past, setPast] = useState<DataHallProject[]>([]);
  const [future, setFuture] = useState<DataHallProject[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [textCommand, setTextCommand] = useState("");
  const [transcript, setTranscript] = useState("Nenhum comando enviado.");
  const [assistantMessage, setAssistantMessage] = useState("Pronto para modelar.");
  const [voiceState, setVoiceState] = useState<RecorderState>("idle");
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [history, setHistory] = useState<Array<{ text: string; message: string; commands: StructuredCommand[] }>>([]);
  const [stageSize, setStageSize] = useState({ width: 900, height: 620 });
  const stageWrapRef = useRef<HTMLDivElement | null>(null);

  const stats = useMemo(() => calculateStats(project), [project]);
  const selected = project.elements.find((element) => element.id === selectedId);
  const scale = Math.min(
    (stageSize.width - 48) / Math.max(project.room.widthM, 1),
    (stageSize.height - 48) / Math.max(project.room.lengthM, 1)
  );
  const offset = {
    x: (stageSize.width - project.room.widthM * scale) / 2,
    y: (stageSize.height - project.room.lengthM * scale) / 2
  };

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((health) => setAiReady(Boolean(health.aiConfigured)))
      .catch(() => setAiReady(false));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  useEffect(() => {
    const update = () => {
      const rect = stageWrapRef.current?.getBoundingClientRect();
      if (rect) setStageSize({ width: Math.max(320, rect.width), height: Math.max(380, rect.height) });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  function commit(next: DataHallProject, message?: string) {
    setPast((items) => [...items.slice(-49), project]);
    setFuture([]);
    setProject(validateProject(next));
    if (message) setAssistantMessage(message);
  }

  function applyManualSettings(form: FormData) {
    const desiredFanWallCount = numberFrom(form, "fanCount");
    const currentFanWallCount = project.elements.filter((element) => element.type === "fanWall").length;
    const fanWallCommand: StructuredCommand = {
      type: "add_fan_walls",
      count: desiredFanWallCount >= currentFanWallCount ? desiredFanWallCount - currentFanWallCount : desiredFanWallCount,
      wall: form.get("fanWall") as Wall,
      widthM: numberFrom(form, "fanWidth"),
      depthM: numberFrom(form, "fanDepth"),
      heightM: numberFrom(form, "fanHeight"),
      airflowM3h: numberFrom(form, "fanAirflow")
    };
    const commands: StructuredCommand[] = [
      {
        type: "resize_room",
        widthM: numberFrom(form, "roomWidth"),
        lengthM: numberFrom(form, "roomLength"),
        heightM: numberFrom(form, "roomHeight")
      },
      {
        type: "add_racks",
        count: Math.max(0, numberFrom(form, "rackCount") - project.elements.filter((e) => e.type === "rack").length),
        widthM: numberFrom(form, "rackWidth"),
        depthM: numberFrom(form, "rackDepth"),
        heightM: numberFrom(form, "rackHeight"),
        powerKw: numberFrom(form, "rackPower")
      },
      {
        type: "create_rack_rows",
        rows: numberFrom(form, "rackRows"),
        count: numberFrom(form, "rackCount"),
        coldAisleM: numberFrom(form, "coldAisle"),
        hotAisleM: numberFrom(form, "hotAisle")
      },
      ...(desiredFanWallCount < currentFanWallCount
        ? ([{ type: "clear_layout", target: "fanWalls" }, fanWallCommand] as StructuredCommand[])
        : [fanWallCommand]),
      { type: "set_wall_clearance", wallClearanceM: numberFrom(form, "wallClearance") },
      { type: "auto_arrange" }
    ];
    commit(applyCommands(project, commands), "Parametros aplicados e layout organizado.");
  }

  async function submitTextCommand(text = textCommand, source: "text" | "voice" = "text") {
    const command = text.trim();
    if (!command) return;
    try {
      setVoiceState("interpreting");
      if (source === "text") setTranscript(command);
      setTextCommand("");
      const response = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: command, project: projectForAi(project) })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao interpretar comando.");
      const commands = commandListSchema.parse(payload.commands);
      const localCommands = commands.filter((item) => item.type !== "undo" && item.type !== "redo") as StructuredCommand[];
      if (commands.some((item) => item.type === "undo")) return undo();
      if (commands.some((item) => item.type === "redo")) return redo();
      const next = applyCommands(project, localCommands);
      commit(next, payload.message || "Comando aplicado.");
      setHistory((items) => [{ text: command, message: payload.message, commands }, ...items].slice(0, 8));
      setVoiceState("done");
    } catch (error) {
      setAssistantMessage(error instanceof z.ZodError ? "Comandos rejeitados pela validacao local." : errorMessage(error));
      setVoiceState("error");
    }
  }

  async function startVoice(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    try {
      await recorder.start();
      event.currentTarget.setPointerCapture(event.pointerId);
      setVoiceState("recording");
    } catch (error) {
      setAssistantMessage(errorMessage(error));
      setVoiceState("error");
    }
  }

  async function stopVoice() {
    if (voiceState !== "recording") return;
    try {
      setVoiceState("sending");
      const blob = await recorder.stop();
      if (!blob || blob.size < 256) throw new Error("A gravacao ficou muito curta.");
      const audioBase64 = await blobToBase64(blob);
      setVoiceState("transcribing");
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType: blob.type })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha na transcricao.");
      setTranscript(payload.text);
      await submitTextCommand(payload.text, "voice");
    } catch (error) {
      setAssistantMessage(errorMessage(error));
      setVoiceState("error");
    }
  }

  function undo() {
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((items) => [project, ...items]);
    setPast((items) => items.slice(0, -1));
    setProject(previous);
    setAssistantMessage("Alteracao desfeita.");
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setPast((items) => [...items, project]);
    setFuture((items) => items.slice(1));
    setProject(next);
    setAssistantMessage("Alteracao refeita.");
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

  function deleteSelectedElement() {
    if (!selected) return;
    commit(applyCommands(project, [{ type: "delete_element", id: selected.id }]), `${selected.label} deletado.`);
    setSelectedId("");
  }

  function loadJson(file: File | undefined) {
    if (!file) return;
    file
      .text()
      .then((content) => commit(normalizeProject(JSON.parse(content)), "Projeto carregado do JSON."))
      .catch(() => setAssistantMessage("Nao foi possivel carregar o JSON."));
  }

  function onDragEnd(element: DataHallElement, x: number, y: number) {
    const roomX = (x - offset.x) / scale;
    const roomY = (y - offset.y) / scale;
    commit(moveElement(project, element.id, roomX, roomY), `${element.label} reposicionado.`);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">CFD-WEB</span>
          <h1>Data Hall Parametric Modeler</h1>
        </div>
        <div className="top-actions">
          <span className={`ai-badge ${aiReady ? "ready" : "offline"}`}>
            {aiReady === null ? "Verificando IA" : aiReady ? "IA pronta" : "IA sem chave"}
          </span>
          <button type="button" onClick={undo} disabled={!past.length}>Desfazer</button>
          <button type="button" onClick={redo} disabled={!future.length}>Refazer</button>
          <button type="button" onClick={() => commit(autoArrange(project), "Layout reorganizado.")}>Auto</button>
          <button type="button" onClick={() => commit(applyCommands(project, [{ type: "clear_layout" }]), "Layout limpo.")}>Limpar</button>
        </div>
      </header>

      <section className="workspace">
        <form
          className="panel controls"
          key={`${project.room.widthM}-${project.room.lengthM}-${project.room.heightM}-${stats.rackCount}-${stats.fanWallCount}-${project.settings.rackRows}`}
          onSubmit={(event) => {
            event.preventDefault();
            applyManualSettings(new FormData(event.currentTarget));
          }}
        >
          <h2>Parametros</h2>
          <Fieldset title="Sala">
            <NumberInput name="roomWidth" label="Largura (m)" value={project.room.widthM} min={3} />
            <NumberInput name="roomLength" label="Comprimento (m)" value={project.room.lengthM} min={3} />
            <NumberInput name="roomHeight" label="Altura (m)" value={project.room.heightM} min={2} />
          </Fieldset>
          <Fieldset title="Racks">
            <NumberInput name="rackCount" label="Quantidade" value={stats.rackCount} min={0} step={1} />
            <NumberInput name="rackRows" label="Fileiras" value={project.settings.rackRows} min={1} step={1} />
            <NumberInput name="rackWidth" label="Largura" value={project.rackDefaults.widthM} min={0.3} />
            <NumberInput name="rackDepth" label="Profundidade" value={project.rackDefaults.depthM} min={0.4} />
            <NumberInput name="rackHeight" label="Altura" value={project.rackDefaults.heightM} min={0.5} />
            <NumberInput name="rackPower" label="Potencia kW" value={project.rackDefaults.powerKw} min={0} step={1} />
          </Fieldset>
          <Fieldset title="Fan walls">
            <NumberInput name="fanCount" label="Quantidade" value={stats.fanWallCount} min={0} step={1} />
            <SelectInput name="fanWall" label="Parede" value={project.fanWallDefaults.wall} />
            <NumberInput name="fanWidth" label="Largura" value={project.fanWallDefaults.widthM} min={0.3} />
            <NumberInput name="fanDepth" label="Profundidade" value={project.fanWallDefaults.depthM} min={0.2} />
            <NumberInput name="fanHeight" label="Altura" value={project.fanWallDefaults.heightM} min={0.5} />
            <NumberInput name="fanAirflow" label="Vazao m3/h" value={project.fanWallDefaults.airflowM3h} min={0} step={100} />
          </Fieldset>
          <Fieldset title="Corredores">
            <NumberInput name="coldAisle" label="Frio (m)" value={project.settings.coldAisleM} min={0.4} />
            <NumberInput name="hotAisle" label="Quente (m)" value={project.settings.hotAisleM} min={0.4} />
            <NumberInput name="wallClearance" label="Parede (m)" value={project.settings.wallClearanceM} min={0} />
          </Fieldset>
          <button type="submit" className="primary">Aplicar parametros</button>
        </form>

        <section className="model-area">
          <div className="canvas-frame" ref={stageWrapRef}>
            <Stage width={stageSize.width} height={stageSize.height}>
              <Layer>
                <Grid room={project.room} scale={scale} offset={offset} />
                <Rect
                  x={offset.x}
                  y={offset.y}
                  width={project.room.widthM * scale}
                  height={project.room.lengthM * scale}
                  fill="#f7fbff"
                  stroke="#10202f"
                  strokeWidth={2}
                />
                {project.elements.map((element) => (
                  <ModelElement
                    key={element.id}
                    element={element}
                    selected={element.id === selectedId}
                    scale={scale}
                    offset={offset}
                    onSelect={() => setSelectedId(element.id)}
                    onDragEnd={onDragEnd}
                    onRotate={() => commit(rotateElement(project, element.id, element.rotation + 90), `${element.label} rotacionado.`)}
                  />
                ))}
              </Layer>
            </Stage>
          </div>
          <section className="voice-panel">
            <button
              type="button"
              className={`mic ${voiceState === "recording" ? "recording" : ""}`}
              onPointerDown={startVoice}
              onPointerUp={stopVoice}
              onPointerCancel={() => recorder.cancel()}
            >
              <span>{voiceState === "recording" ? "Gravando" : "Microfone"}</span>
            </button>
            <div className="command-box">
              <p className={`voice-state ${voiceState}`}>{voiceLabel(voiceState)}</p>
              <div className="command-line">
                <input value={textCommand} onChange={(event) => setTextCommand(event.target.value)} placeholder="Digite uma instrucao para o data hall" />
                <button type="button" onClick={() => submitTextCommand()}>Enviar</button>
              </div>
              <div className="transcript-grid">
                <article><span>Transcricao</span><p>{transcript}</p></article>
                <article><span>Resposta</span><p>{assistantMessage}</p></article>
              </div>
            </div>
          </section>
        </section>

        <aside className="panel insights">
          <h2>Indicadores</h2>
          <Metric label="Racks" value={stats.rackCount} />
          <Metric label="Fan walls" value={stats.fanWallCount} />
          <Metric label="Potencia total" value={`${format(stats.totalPowerKw, 0)} kW`} />
          <Metric label="Area ocupada" value={`${format(stats.occupiedAreaM2)} m2`} />
          <Metric label="Ocupacao" value={`${format(stats.occupiedPercent)}%`} />
          <Metric label="Area da sala" value={`${format(stats.roomAreaM2)} m2`} />
          <div className="file-actions">
            <button type="button" onClick={saveJson}>Salvar JSON</button>
            <label className="file-label">Carregar JSON<input type="file" accept="application/json" onChange={(event) => loadJson(event.target.files?.[0])} /></label>
          </div>
          <h3>Alertas</h3>
          <ul className="alerts">
            {project.warnings.length ? project.warnings.map((warning) => <li key={warning}>{warning}</li>) : <li>Nenhum alerta.</li>}
          </ul>
          <h3>Selecionado</h3>
          <div className="selected">
            {selected ? (
              <>
                <p>{`${selected.label}: X ${format(selected.x)} m, Y ${format(selected.y)} m, ${format(selected.widthM)} x ${format(selected.depthM)} x ${format(selected.heightM)} m`}</p>
                <button type="button" className="danger" onClick={deleteSelectedElement}>Deletar equipamento</button>
              </>
            ) : (
              "Selecione um elemento."
            )}
          </div>
          <h3>Historico</h3>
          <ol className="history">
            {history.map((item, index) => <li key={`${item.text}-${index}`}><strong>{item.text}</strong><span>{item.commands.map((command) => command.type).join(", ")}</span></li>)}
          </ol>
        </aside>
      </section>
    </main>
  );
}

function Fieldset({ title, children }: { title: string; children: React.ReactNode }) {
  return <fieldset><legend>{title}</legend><div className="field-grid">{children}</div></fieldset>;
}

function NumberInput({ name, label, value, min, step = 0.1 }: { name: string; label: string; value: number; min: number; step?: number }) {
  return <label>{label}<input name={name} type="number" min={min} step={step} defaultValue={value} /></label>;
}

function SelectInput({ name, label, value }: { name: string; label: string; value: Wall }) {
  return <label>{label}<select name={name} defaultValue={value}><option value="north">Norte</option><option value="south">Sul</option><option value="east">Leste</option><option value="west">Oeste</option></select></label>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Grid({ room, scale, offset }: { room: DataHallProject["room"]; scale: number; offset: { x: number; y: number } }) {
  const lines = [];
  for (let x = 0; x <= room.widthM; x += 1) {
    lines.push(<Line key={`x-${x}`} points={[offset.x + x * scale, offset.y, offset.x + x * scale, offset.y + room.lengthM * scale]} stroke="#d8e2ea" strokeWidth={1} />);
  }
  for (let y = 0; y <= room.lengthM; y += 1) {
    lines.push(<Line key={`y-${y}`} points={[offset.x, offset.y + y * scale, offset.x + room.widthM * scale, offset.y + y * scale]} stroke="#d8e2ea" strokeWidth={1} />);
  }
  return <>{lines}</>;
}

function ModelElement(props: {
  element: DataHallElement;
  selected: boolean;
  scale: number;
  offset: { x: number; y: number };
  onSelect: () => void;
  onDragEnd: (element: DataHallElement, x: number, y: number) => void;
  onRotate: () => void;
}) {
  const { element, selected, scale, offset, onSelect, onDragEnd, onRotate } = props;
  const fill = element.type === "rack" ? "#1f6feb" : "#0c8f7b";
  return (
    <Group
      x={offset.x + element.x * scale}
      y={offset.y + element.y * scale}
      draggable
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={onRotate}
      onDblTap={onRotate}
      onDragEnd={(event) => onDragEnd(element, event.target.x(), event.target.y())}
    >
      <Rect
        width={element.widthM * scale}
        height={element.depthM * scale}
        fill={fill}
        stroke={selected ? "#f0b429" : "#0d1b2a"}
        strokeWidth={selected ? 4 : 1.5}
        cornerRadius={2}
      />
      <Text
        text={element.label}
        width={element.widthM * scale}
        height={element.depthM * scale}
        align="center"
        verticalAlign="middle"
        fill="#ffffff"
        fontStyle="bold"
        fontSize={Math.max(10, Math.min(16, element.widthM * scale * 0.45))}
        listening={false}
      />
    </Group>
  );
}

function loadProject(): DataHallProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DataHallProject>;
      const normalized = normalizeProject(parsed);
      return parsed.layoutRulesVersion === CURRENT_LAYOUT_RULES_VERSION ? normalized : autoArrange(normalized);
    }
    return autoArrange(applyCommands(createDefaultProject(), [{ type: "add_racks", count: 24 }, { type: "add_fan_walls", count: 4 }]));
  } catch {
    return autoArrange(applyCommands(createDefaultProject(), [{ type: "add_racks", count: 24 }, { type: "add_fan_walls", count: 4 }]));
  }
}

function numberFrom(form: FormData, key: string): number {
  return Number(form.get(key));
}

function voiceLabel(state: RecorderState) {
  return {
    idle: "Pressione e mantenha o microfone para gravar.",
    recording: "Gravando. Solte para enviar.",
    sending: "Enviando audio ao backend.",
    transcribing: "Transcrevendo com OpenAI.",
    interpreting: "Interpretando comando estruturado.",
    done: "Concluido.",
    error: "Falha no fluxo de voz ou IA."
  }[state];
}

function projectForAi(project: DataHallProject) {
  return {
    room: project.room,
    rackDefaults: project.rackDefaults,
    fanWallDefaults: project.fanWallDefaults,
    settings: project.settings,
    elements: project.elements.map(({ id, type, label, x, y, z, widthM, depthM, heightM, rotation }) => ({
      id,
      type,
      label,
      x,
      y,
      z,
      widthM,
      depthM,
      heightM,
      rotation
    })),
    warnings: project.warnings
  };
}

function format(value: number, digits = 1) {
  return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "data-hall";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado.";
}

createRoot(document.getElementById("root")!).render(<App />);
