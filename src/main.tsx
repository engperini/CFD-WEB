import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Arrow, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
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
import { getSectionElements, type SectionAxis, type SectionCut } from "./shared/sectionEngine";
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
  const [sectionCut, setSectionCut] = useState<SectionCut>(() => ({ axis: "x", positionM: 9 }));
  const [planSize, setPlanSize] = useState({ width: 900, height: 430 });
  const [sectionSize, setSectionSize] = useState({ width: 900, height: 300 });
  const planWrapRef = useRef<HTMLDivElement | null>(null);
  const sectionWrapRef = useRef<HTMLDivElement | null>(null);

  const stats = useMemo(() => calculateStats(project), [project]);
  const selected = project.elements.find((element) => element.id === selectedId);
  const sectionElements = useMemo(() => getSectionElements(project, sectionCut), [project, sectionCut]);
  const scale = Math.min(
    (planSize.width - 48) / Math.max(project.room.widthM, 1),
    (planSize.height - 48) / Math.max(project.room.lengthM, 1)
  );
  const offset = {
    x: (planSize.width - project.room.widthM * scale) / 2,
    y: (planSize.height - project.room.lengthM * scale) / 2
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
      const planRect = planWrapRef.current?.getBoundingClientRect();
      const sectionRect = sectionWrapRef.current?.getBoundingClientRect();
      if (planRect) setPlanSize({ width: Math.max(320, planRect.width), height: Math.max(300, planRect.height) });
      if (sectionRect) setSectionSize({ width: Math.max(320, sectionRect.width), height: Math.max(240, sectionRect.height) });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    setSectionCut((current) => ({
      ...current,
      positionM: clamp(current.positionM, 0, current.axis === "x" ? project.room.widthM : project.room.lengthM)
    }));
  }, [project.room.widthM, project.room.lengthM]);

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
      {
        type: "create_pillar_grid",
        count: numberFrom(form, "pillarCount"),
        columns: numberFrom(form, "pillarColumns"),
        widthM: numberFrom(form, "pillarWidth"),
        depthM: numberFrom(form, "pillarDepth"),
        heightM: numberFrom(form, "pillarHeight")
      },
      { type: "set_wall_clearance", wallClearanceM: numberFrom(form, "wallClearance") },
      { type: "auto_arrange" }
    ];
    const next = applyCommands(project, commands);
    next.architecture = {
      raisedFloor: {
        enabled: boolFrom(form, "raisedFloorEnabled"),
        visible: boolFrom(form, "raisedFloorVisible"),
        opacity: numberFrom(form, "raisedFloorOpacity"),
        tileWidthM: numberFrom(form, "raisedFloorTileWidth"),
        tileDepthM: numberFrom(form, "raisedFloorTileDepth"),
        heightM: numberFrom(form, "raisedFloorHeight")
      },
      ceiling: {
        enabled: boolFrom(form, "ceilingEnabled"),
        visible: boolFrom(form, "ceilingVisible"),
        opacity: numberFrom(form, "ceilingOpacity"),
        panelWidthM: numberFrom(form, "ceilingPanelWidth"),
        panelDepthM: numberFrom(form, "ceilingPanelDepth"),
        heightM: numberFrom(form, "ceilingHeight")
      }
    };
    next.visibility = {
      racks: { visible: boolFrom(form, "racksVisible"), opacity: numberFrom(form, "racksOpacity") },
      fanWalls: { visible: boolFrom(form, "fanWallsVisible"), opacity: numberFrom(form, "fanWallsOpacity") },
      pillars: { visible: boolFrom(form, "pillarsVisible"), opacity: numberFrom(form, "pillarsOpacity") }
    };
    commit(next, "Parametros aplicados e layout organizado.");
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

  function updateSectionAxis(axis: SectionAxis) {
    setSectionCut({
      axis,
      positionM: axis === "x" ? project.room.widthM / 2 : project.room.lengthM / 2
    });
  }

  function setSectionFromStagePoint(stage: { getPointerPosition: () => { x: number; y: number } | null }) {
    const point = stage.getPointerPosition();
    if (!point) return;
    setSectionCut((current) => ({
      ...current,
      positionM:
        current.axis === "x"
          ? clamp((point.x - offset.x) / scale, 0, project.room.widthM)
          : clamp((point.y - offset.y) / scale, 0, project.room.lengthM)
    }));
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
          <Fieldset title="Pilares">
            <NumberInput name="pillarCount" label="Quantidade" value={stats.pillarCount} min={0} step={1} />
            <NumberInput name="pillarColumns" label="Colunas na malha" value={project.pillarDefaults.columns} min={1} step={1} />
            <NumberInput name="pillarWidth" label="Largura" value={project.pillarDefaults.widthM} min={0.1} />
            <NumberInput name="pillarDepth" label="Profundidade" value={project.pillarDefaults.depthM} min={0.1} />
            <NumberInput name="pillarHeight" label="Altura" value={project.pillarDefaults.heightM} min={0.5} />
          </Fieldset>
          <Fieldset title="Piso elevado">
            <CheckInput name="raisedFloorEnabled" label="Adicionar piso" checked={project.architecture.raisedFloor.enabled} />
            <CheckInput name="raisedFloorVisible" label="Mostrar piso" checked={project.architecture.raisedFloor.visible} />
            <NumberInput name="raisedFloorTileWidth" label="Placa largura" value={project.architecture.raisedFloor.tileWidthM} min={0.3} />
            <NumberInput name="raisedFloorTileDepth" label="Placa profund." value={project.architecture.raisedFloor.tileDepthM} min={0.3} />
            <NumberInput name="raisedFloorHeight" label="Altura piso" value={project.architecture.raisedFloor.heightM} min={0.05} />
            <NumberInput name="raisedFloorOpacity" label="Opacidade" value={project.architecture.raisedFloor.opacity} min={0} max={1} step={0.05} />
          </Fieldset>
          <Fieldset title="Forro sala limpa">
            <CheckInput name="ceilingEnabled" label="Adicionar forro" checked={project.architecture.ceiling.enabled} />
            <CheckInput name="ceilingVisible" label="Mostrar forro" checked={project.architecture.ceiling.visible} />
            <NumberInput name="ceilingPanelWidth" label="Modulo largura" value={project.architecture.ceiling.panelWidthM} min={0.3} />
            <NumberInput name="ceilingPanelDepth" label="Modulo profund." value={project.architecture.ceiling.panelDepthM} min={0.3} />
            <NumberInput name="ceilingHeight" label="Altura forro" value={project.architecture.ceiling.heightM} min={2} />
            <NumberInput name="ceilingOpacity" label="Opacidade" value={project.architecture.ceiling.opacity} min={0} max={1} step={0.05} />
          </Fieldset>
          <Fieldset title="Visibilidade">
            <CheckInput name="racksVisible" label="Mostrar racks" checked={project.visibility.racks.visible} />
            <NumberInput name="racksOpacity" label="Opacidade racks" value={project.visibility.racks.opacity} min={0} max={1} step={0.05} />
            <CheckInput name="fanWallsVisible" label="Mostrar fan walls" checked={project.visibility.fanWalls.visible} />
            <NumberInput name="fanWallsOpacity" label="Opacidade fan walls" value={project.visibility.fanWalls.opacity} min={0} max={1} step={0.05} />
            <CheckInput name="pillarsVisible" label="Mostrar pilares" checked={project.visibility.pillars.visible} />
            <NumberInput name="pillarsOpacity" label="Opacidade pilares" value={project.visibility.pillars.opacity} min={0} max={1} step={0.05} />
          </Fieldset>
          <Fieldset title="Corredores">
            <NumberInput name="coldAisle" label="Frio (m)" value={project.settings.coldAisleM} min={0.4} />
            <NumberInput name="hotAisle" label="Quente (m)" value={project.settings.hotAisleM} min={0.4} />
            <NumberInput name="wallClearance" label="Parede (m)" value={project.settings.wallClearanceM} min={0} />
          </Fieldset>
          <button type="submit" className="primary">Aplicar parametros</button>
        </form>

        <section className="model-area">
          <section className="views-grid">
            <div className="drawing-frame plan-frame" ref={planWrapRef}>
              <div className="drawing-title">
                <div>
                  <span className="eyebrow">Planta</span>
                  <h2>Layout superior</h2>
                </div>
                <span>Clique na sala ou arraste A-A</span>
              </div>
              <Stage width={planSize.width} height={planSize.height}>
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
                    onClick={(event) => setSectionFromStagePoint(event.target.getStage()!)}
                    onTap={(event) => setSectionFromStagePoint(event.target.getStage()!)}
                  />
                  <ArchitecturalPlanLayers project={project} scale={scale} offset={offset} />
                  {project.elements.filter((element) => visibilityForElement(project, element).visible).map((element) => (
                    <ModelElement
                      key={element.id}
                      element={element}
                      selected={element.id === selectedId}
                      opacity={visibilityForElement(project, element).opacity}
                      scale={scale}
                      offset={offset}
                      onSelect={() => setSelectedId(element.id)}
                      onDragEnd={onDragEnd}
                      onRotate={() => commit(rotateElement(project, element.id, element.rotation + 90), `${element.label} rotacionado.`)}
                    />
                  ))}
                  <SectionCutLine
                    cut={sectionCut}
                    room={project.room}
                    scale={scale}
                    offset={offset}
                    onChange={(positionM) => setSectionCut((current) => ({ ...current, positionM }))}
                  />
                </Layer>
              </Stage>
            </div>

            <div className="drawing-frame section-frame" ref={sectionWrapRef}>
              <div className="drawing-title">
                <div>
                  <span className="eyebrow">Corte A-A</span>
                  <h2>{sectionCut.axis === "x" ? "Longitudinal Y-Z" : "Transversal X-Z"}</h2>
                </div>
                <div className="section-controls">
                  <button type="button" className={sectionCut.axis === "x" ? "active" : ""} onClick={() => updateSectionAxis("x")}>Longitudinal</button>
                  <button type="button" className={sectionCut.axis === "y" ? "active" : ""} onClick={() => updateSectionAxis("y")}>Transversal</button>
                </div>
              </div>
              <SectionView
                project={project}
                cut={sectionCut}
                elements={sectionElements.filter((element) => visibilityForElement(project, element).visible)}
                size={sectionSize}
              />
            </div>
          </section>
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
          <Metric label="Pilares" value={stats.pillarCount} />
          <Metric label="Potencia total" value={`${format(stats.totalPowerKw, 0)} kW`} />
          <Metric label="Area ocupada" value={`${format(stats.occupiedAreaM2)} m2`} />
          <Metric label="Ocupacao" value={`${format(stats.occupiedPercent)}%`} />
          <Metric label="Area da sala" value={`${format(stats.roomAreaM2)} m2`} />
          <Metric label="Corte A-A" value={`${sectionCut.axis === "x" ? "X" : "Y"} ${format(sectionCut.positionM)} m`} />
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

function NumberInput({
  name,
  label,
  value,
  min,
  max,
  step = 0.1
}: {
  name: string;
  label: string;
  value: number;
  min: number;
  max?: number;
  step?: number;
}) {
  return <label>{label}<input name={name} type="number" min={min} max={max} step={step} defaultValue={value} /></label>;
}

function CheckInput({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return <label className="check-field"><input name={name} type="checkbox" defaultChecked={checked} />{label}</label>;
}

function SelectInput({ name, label, value }: { name: string; label: string; value: Wall }) {
  return <label>{label}<select name={name} defaultValue={value}><option value="north">Norte</option><option value="south">Sul</option><option value="east">Leste</option><option value="west">Oeste</option></select></label>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function ArchitecturalPlanLayers({ project, scale, offset }: { project: DataHallProject; scale: number; offset: { x: number; y: number } }) {
  const layers = [];
  if (project.architecture.raisedFloor.enabled && project.architecture.raisedFloor.visible) {
    layers.push(
      <GridOverlay
        key="raised-floor"
        room={project.room}
        scale={scale}
        offset={offset}
        stepX={project.architecture.raisedFloor.tileWidthM}
        stepY={project.architecture.raisedFloor.tileDepthM}
        stroke="#8aa0ae"
        opacity={project.architecture.raisedFloor.opacity}
      />
    );
  }
  if (project.architecture.ceiling.enabled && project.architecture.ceiling.visible) {
    layers.push(
      <GridOverlay
        key="ceiling"
        room={project.room}
        scale={scale}
        offset={offset}
        stepX={project.architecture.ceiling.panelWidthM}
        stepY={project.architecture.ceiling.panelDepthM}
        stroke="#a36d2f"
        opacity={project.architecture.ceiling.opacity}
        dash={[8, 5]}
      />
    );
  }
  return <>{layers}</>;
}

function GridOverlay(props: {
  room: DataHallProject["room"];
  scale: number;
  offset: { x: number; y: number };
  stepX: number;
  stepY: number;
  stroke: string;
  opacity: number;
  dash?: number[];
}) {
  const { room, scale, offset, stepX, stepY, stroke, opacity, dash } = props;
  const lines = [];
  for (let x = stepX; x < room.widthM; x += stepX) {
    lines.push(
      <Line
        key={`x-${x}`}
        points={[offset.x + x * scale, offset.y, offset.x + x * scale, offset.y + room.lengthM * scale]}
        stroke={stroke}
        opacity={opacity}
        strokeWidth={1}
        dash={dash}
      />
    );
  }
  for (let y = stepY; y < room.lengthM; y += stepY) {
    lines.push(
      <Line
        key={`y-${y}`}
        points={[offset.x, offset.y + y * scale, offset.x + room.widthM * scale, offset.y + y * scale]}
        stroke={stroke}
        opacity={opacity}
        strokeWidth={1}
        dash={dash}
      />
    );
  }
  return <>{lines}</>;
}

function SectionCutLine(props: {
  cut: SectionCut;
  room: DataHallProject["room"];
  scale: number;
  offset: { x: number; y: number };
  onChange: (positionM: number) => void;
}) {
  const { cut, room, scale, offset, onChange } = props;
  const isVertical = cut.axis === "x";
  const x = offset.x + (isVertical ? cut.positionM * scale : 0);
  const y = offset.y + (isVertical ? 0 : cut.positionM * scale);
  const points = isVertical ? [0, 0, 0, room.lengthM * scale] : [0, 0, room.widthM * scale, 0];
  const viewArrowStart = isVertical
    ? [26, room.lengthM * scale * 0.35, 2, room.lengthM * scale * 0.35]
    : [room.widthM * scale * 0.35, 26, room.widthM * scale * 0.35, 2];
  const viewArrowEnd = isVertical
    ? [26, room.lengthM * scale * 0.65, 2, room.lengthM * scale * 0.65]
    : [room.widthM * scale * 0.65, 26, room.widthM * scale * 0.65, 2];

  return (
    <Group
      x={x}
      y={y}
      draggable
      dragBoundFunc={(position) =>
        isVertical
          ? { x: clamp(position.x, offset.x, offset.x + room.widthM * scale), y: offset.y }
          : { x: offset.x, y: clamp(position.y, offset.y, offset.y + room.lengthM * scale) }
      }
      onDragEnd={(event) => {
        const next = isVertical ? (event.target.x() - offset.x) / scale : (event.target.y() - offset.y) / scale;
        onChange(clamp(next, 0, isVertical ? room.widthM : room.lengthM));
      }}
    >
      <Line points={points} stroke="#b83232" strokeWidth={3} dash={[18, 7, 3, 7]} />
      <Arrow points={viewArrowStart} pointerLength={10} pointerWidth={10} fill="#b83232" stroke="#b83232" strokeWidth={2} />
      <Arrow points={viewArrowEnd} pointerLength={10} pointerWidth={10} fill="#b83232" stroke="#b83232" strokeWidth={2} />
      <Text
        text="A"
        x={isVertical ? -18 : -34}
        y={isVertical ? -36 : -17}
        width={24}
        height={20}
        align="center"
        verticalAlign="middle"
        fill="#b83232"
        fontStyle="bold"
        fontSize={14}
      />
      <Text
        text="A"
        x={isVertical ? -18 : room.widthM * scale + 12}
        y={isVertical ? room.lengthM * scale + 14 : -17}
        width={24}
        height={20}
        align="center"
        verticalAlign="middle"
        fill="#b83232"
        fontStyle="bold"
        fontSize={14}
      />
    </Group>
  );
}

function SectionView(props: {
  project: DataHallProject;
  cut: SectionCut;
  elements: DataHallElement[];
  size: { width: number; height: number };
}) {
  const { project, cut, elements, size } = props;
  const horizontalM = cut.axis === "x" ? project.room.lengthM : project.room.widthM;
  const margin = { left: 52, right: 26, top: 30, bottom: 46 };
  const drawingWidth = Math.max(1, size.width - margin.left - margin.right);
  const drawingHeight = Math.max(1, size.height - margin.top - margin.bottom);
  const sectionScale = Math.min(drawingWidth / horizontalM, drawingHeight / project.room.heightM);
  const origin = {
    x: margin.left + (drawingWidth - horizontalM * sectionScale) / 2,
    y: margin.top + (drawingHeight - project.room.heightM * sectionScale) / 2
  };
  const floorY = origin.y + project.room.heightM * sectionScale;
  const ceilingY = origin.y;

  return (
    <Stage width={size.width} height={size.height}>
      <Layer>
        <Rect x={0} y={0} width={size.width} height={size.height} fill="#f7fbff" />
        <Line points={[origin.x, ceilingY, origin.x + horizontalM * sectionScale, ceilingY]} stroke="#10202f" strokeWidth={2} />
        <Line points={[origin.x, floorY, origin.x + horizontalM * sectionScale, floorY]} stroke="#10202f" strokeWidth={3} />
        <Line points={[origin.x, ceilingY, origin.x, floorY]} stroke="#10202f" strokeWidth={2} />
        <Line points={[origin.x + horizontalM * sectionScale, ceilingY, origin.x + horizontalM * sectionScale, floorY]} stroke="#10202f" strokeWidth={2} />
        <Text text="A-A" x={origin.x} y={8} fill="#10202f" fontStyle="bold" fontSize={14} />
        <Text
          text={`${cut.axis === "x" ? "Plano X" : "Plano Y"} = ${format(cut.positionM)} m | vista ${cut.axis === "x" ? "direita-esquerda" : "inferior-superior"}`}
          x={origin.x + 52}
          y={8}
          fill="#50606d"
          fontSize={13}
        />
        {elements.map((element) => {
          const horizontalPosition = cut.axis === "x" ? element.y : element.x;
          const horizontalSize = cut.axis === "x" ? element.depthM : element.widthM;
          const x = origin.x + horizontalPosition * sectionScale;
          const y = floorY - element.heightM * sectionScale;
          const width = Math.max(2, horizontalSize * sectionScale);
          const height = Math.max(2, element.heightM * sectionScale);
          const visibility = visibilityForElement(project, element);
          const colors = elementColors(element);
          return (
            <Group key={element.id} opacity={visibility.opacity}>
              <Rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={colors.sectionFill}
                stroke={colors.stroke}
                strokeWidth={2}
              />
              <HatchLines x={x} y={y} width={width} height={height} stroke={colors.stroke} />
              <Text text={element.label} x={x - 12} y={y - 18} width={width + 24} align="center" fill="#10202f" fontStyle="bold" fontSize={12} />
            </Group>
          );
        })}
        <ArchitectureSectionLayers project={project} origin={origin} floorY={floorY} sectionScale={sectionScale} horizontalM={horizontalM} />
        <Line
          points={[origin.x, floorY + 22, origin.x + horizontalM * sectionScale, floorY + 22]}
          stroke="#50606d"
          strokeWidth={1}
        />
        <Line points={[origin.x, floorY + 14, origin.x, floorY + 30]} stroke="#50606d" strokeWidth={1} />
        <Line points={[origin.x + horizontalM * sectionScale, floorY + 14, origin.x + horizontalM * sectionScale, floorY + 30]} stroke="#50606d" strokeWidth={1} />
        <Text
          text={`${format(horizontalM)} m`}
          x={origin.x}
          y={floorY + 27}
          width={horizontalM * sectionScale}
          align="center"
          fill="#50606d"
          fontSize={12}
        />
        <Text
          text={`${format(project.room.heightM)} m`}
          x={origin.x - 48}
          y={origin.y + project.room.heightM * sectionScale / 2 - 8}
          fill="#50606d"
          fontSize={12}
        />
        {elements.length === 0 ? (
          <Text
            text="Nenhum equipamento no lado observado deste plano de corte."
            x={origin.x}
            y={origin.y + project.room.heightM * sectionScale / 2 - 8}
            width={horizontalM * sectionScale}
            align="center"
            fill="#50606d"
            fontSize={13}
          />
        ) : null}
      </Layer>
    </Stage>
  );
}

function HatchLines({ x, y, width, height, stroke }: { x: number; y: number; width: number; height: number; stroke: string }) {
  const lines = [];
  const spacing = 9;
  for (let offsetValue = -height; offsetValue < width; offsetValue += spacing) {
    const x1 = x + Math.max(0, offsetValue);
    const y1 = y + Math.max(0, -offsetValue);
    const x2 = x + Math.min(width, offsetValue + height);
    const y2 = y + Math.min(height, height - Math.max(0, offsetValue + height - width));
    lines.push(<Line key={offsetValue} points={[x1, y1, x2, y2]} stroke={stroke} strokeWidth={0.6} opacity={0.35} />);
  }
  return <>{lines}</>;
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
  opacity: number;
  scale: number;
  offset: { x: number; y: number };
  onSelect: () => void;
  onDragEnd: (element: DataHallElement, x: number, y: number) => void;
  onRotate: () => void;
}) {
  const { element, selected, opacity, scale, offset, onSelect, onDragEnd, onRotate } = props;
  const colors = elementColors(element);
  return (
    <Group
      x={offset.x + element.x * scale}
      y={offset.y + element.y * scale}
      opacity={opacity}
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
        fill={colors.fill}
        stroke={selected ? "#f0b429" : colors.stroke}
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

function ArchitectureSectionLayers(props: {
  project: DataHallProject;
  origin: { x: number; y: number };
  floorY: number;
  sectionScale: number;
  horizontalM: number;
}) {
  const { project, origin, floorY, sectionScale, horizontalM } = props;
  return (
    <>
      {project.architecture.raisedFloor.enabled && project.architecture.raisedFloor.visible ? (
        <Group opacity={project.architecture.raisedFloor.opacity}>
          <Rect
            x={origin.x}
            y={floorY - project.architecture.raisedFloor.heightM * sectionScale}
            width={horizontalM * sectionScale}
            height={project.architecture.raisedFloor.heightM * sectionScale}
            fill="#cbd6de"
            stroke="#6c7f8d"
            strokeWidth={1.5}
          />
        </Group>
      ) : null}
      {project.architecture.ceiling.enabled && project.architecture.ceiling.visible ? (
        <Line
          points={[
            origin.x,
            floorY - project.architecture.ceiling.heightM * sectionScale,
            origin.x + horizontalM * sectionScale,
            floorY - project.architecture.ceiling.heightM * sectionScale
          ]}
          stroke="#a36d2f"
          strokeWidth={4}
          opacity={project.architecture.ceiling.opacity}
          dash={[12, 6]}
        />
      ) : null}
    </>
  );
}

function visibilityForElement(project: DataHallProject, element: DataHallElement) {
  if (element.type === "rack") return project.visibility.racks;
  if (element.type === "fanWall") return project.visibility.fanWalls;
  return project.visibility.pillars;
}

function elementColors(element: DataHallElement) {
  if (element.type === "rack") return { fill: "#1f6feb", sectionFill: "#d8e7ff", stroke: "#1f6feb" };
  if (element.type === "fanWall") return { fill: "#0c8f7b", sectionFill: "#d9f3ef", stroke: "#0c8f7b" };
  return { fill: "#8a8f98", sectionFill: "#d8dadd", stroke: "#4b5563" };
}

function boolFrom(form: FormData, key: string): boolean {
  return form.get(key) === "on";
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
    pillarDefaults: project.pillarDefaults,
    architecture: project.architecture,
    visibility: project.visibility,
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "data-hall";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado.";
}

createRoot(document.getElementById("root")!).render(<App />);
