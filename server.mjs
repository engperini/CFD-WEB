import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const MAX_JSON_BYTES = 28 * 1024 * 1024;

loadDotEnv(join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5-mini";
const TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        aiConfigured: Boolean(OPENAI_API_KEY),
        textModel: TEXT_MODEL,
        transcriptionModel: TRANSCRIPTION_MODEL
      });
    }

    if (req.method === "POST" && url.pathname === "/api/transcribe") {
      return await handleTranscription(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/interpret") {
      return await handleInterpretation(req, res);
    }

    if (req.method === "GET") {
      return await serveStatic(url.pathname, res);
    }

    sendJson(res, 404, { error: "Rota não encontrada." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Erro interno do servidor." });
  }
});

server.listen(PORT, () => {
  console.log(`CFD-WEB disponível em http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY não configurada: voz e interpretação por IA estarão desativadas.");
  }
});

async function handleTranscription(req, res) {
  requireApiKey(res);
  if (!OPENAI_API_KEY) return;

  const body = await readJsonBody(req);
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";

  if (!audioBase64) {
    return sendJson(res, 400, { error: "Áudio não informado." });
  }

  let audioBuffer;
  try {
    audioBuffer = Buffer.from(audioBase64, "base64");
  } catch {
    return sendJson(res, 400, { error: "Áudio inválido." });
  }

  if (audioBuffer.byteLength < 256) {
    return sendJson(res, 400, { error: "A gravação ficou vazia ou muito curta." });
  }

  const extension = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
      ? "mp4"
      : mimeType.includes("wav")
        ? "wav"
        : "webm";

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mimeType }), `command.${extension}`);
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("language", "pt");
  form.append(
    "prompt",
    "Transcrição técnica em português do Brasil sobre data centers, data halls, racks, fan walls, corredores, potência, vazão e dimensões em metros ou milímetros."
  );

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  });

  const payload = await readOpenAIResponse(response);
  if (!response.ok) {
    return sendJson(res, response.status, {
      error: payload.error?.message || "Não foi possível transcrever o áudio."
    });
  }

  const text = String(payload.text || "").trim();
  if (!text) {
    return sendJson(res, 422, { error: "Nenhuma fala foi identificada." });
  }

  sendJson(res, 200, { text });
}

async function handleInterpretation(req, res) {
  requireApiKey(res);
  if (!OPENAI_API_KEY) return;

  const body = await readJsonBody(req);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const project = body.project && typeof body.project === "object" ? body.project : {};

  if (!text) {
    return sendJson(res, 400, { error: "Comando não informado." });
  }

  const schema = {
    message: "Resposta curta em português explicando o que será alterado.",
    actions: [
      {
        type: "set_room | configure_racks | configure_fan_walls | set_aisles | optimize_layout | clear",
        widthM: "number opcional",
        lengthM: "number opcional",
        heightM: "number opcional",
        count: "integer opcional",
        rows: "integer opcional",
        depthM: "number opcional",
        powerKw: "number opcional",
        airflowM3h: "number opcional",
        wall: "north | south | east | west opcional",
        coldM: "number opcional",
        hotM: "number opcional",
        perimeterM: "number opcional",
        mode: "balanced | capacity | maintenance opcional",
        target: "racks | fanWalls | all opcional"
      }
    ]
  };

  const instructions = [
    "Você é o copiloto técnico de um modelador de data hall.",
    "Converta o pedido do usuário em ações estruturadas e seguras.",
    "Não gere coordenadas individuais e não invente elementos fora dos tipos permitidos.",
    "Use metros nos campos terminados em M e kW em powerKw.",
    "Interprete 600 mm como 0.6 m, por exemplo.",
    "Preserve valores existentes que o usuário não pediu para mudar.",
    "Quando o usuário pedir para organizar, inclua optimize_layout.",
    "Retorne somente JSON válido, sem markdown.",
    `Formato esperado: ${JSON.stringify(schema)}`,
    `Estado atual: ${JSON.stringify(project)}`
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      store: false,
      instructions,
      input: text
    })
  });

  const payload = await readOpenAIResponse(response);
  if (!response.ok) {
    return sendJson(res, response.status, {
      error: payload.error?.message || "A IA não conseguiu interpretar o comando."
    });
  }

  const outputText = extractResponseText(payload);
  const parsed = parseJsonObject(outputText);
  if (!parsed) {
    return sendJson(res, 502, {
      error: "A IA retornou uma resposta que não pôde ser interpretada."
    });
  }

  const actions = sanitizeActions(parsed.actions);
  sendJson(res, 200, {
    message: String(parsed.message || "Comando aplicado.").slice(0, 400),
    actions
  });
}

function sanitizeActions(candidate) {
  if (!Array.isArray(candidate)) return [];

  const allowedTypes = new Set([
    "set_room",
    "configure_racks",
    "configure_fan_walls",
    "set_aisles",
    "optimize_layout",
    "clear"
  ]);

  return candidate.slice(0, 12).flatMap((action) => {
    if (!action || typeof action !== "object" || !allowedTypes.has(action.type)) {
      return [];
    }

    const clean = { type: action.type };
    const numericFields = [
      "widthM",
      "lengthM",
      "heightM",
      "count",
      "rows",
      "depthM",
      "powerKw",
      "airflowM3h",
      "coldM",
      "hotM",
      "perimeterM"
    ];

    for (const field of numericFields) {
      const value = Number(action[field]);
      if (Number.isFinite(value) && value >= 0) clean[field] = value;
    }

    if (["north", "south", "east", "west"].includes(action.wall)) {
      clean.wall = action.wall;
    }
    if (["balanced", "capacity", "maintenance"].includes(action.mode)) {
      clean.mode = action.mode;
    }
    if (["racks", "fanWalls", "all"].includes(action.target)) {
      clean.target = action.target;
    }

    return [clean];
  });
}

function extractResponseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;

  const parts = [];
  for (const output of payload.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function parseJsonObject(text) {
  if (!text) return null;
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "Acesso negado." });
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Arquivo não encontrado." });
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      const error = new Error("Payload muito grande.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("JSON inválido.");
    error.statusCode = 400;
    throw error;
  }
}

async function readOpenAIResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text || "Resposta inválida da OpenAI." } };
  }
}

function requireApiKey(res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 503, {
      error: "OPENAI_API_KEY não configurada no servidor."
    });
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}
