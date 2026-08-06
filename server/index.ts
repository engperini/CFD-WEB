import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { ZodError } from "zod";
import {
  commandListSchema,
  interpretRequestSchema,
  interpretResponseSchema,
  transcribeRequestSchema
} from "../src/shared/commandSchemas.js";

const ROOT = process.cwd();
const DIST_DIR = join(ROOT, "dist");
const MAX_JSON_BYTES = 28 * 1024 * 1024;

loadDotEnv(join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5-mini";
const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";

const mimeTypes: Record<string, string> = {
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

    if (req.method === "GET") return await serveStatic(url.pathname, res);
    sendJson(res, 404, { error: "Rota nao encontrada." });
  } catch (error) {
    handleError(res, error);
  }
});

server.listen(PORT, () => {
  console.log(`CFD-WEB disponivel em http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY nao configurada: voz e interpretacao por IA ficam desativadas.");
  }
});

async function handleTranscription(req: IncomingMessage, res: ServerResponse) {
  if (!requireApiKey(res)) return;

  const body = transcribeRequestSchema.parse(await readJsonBody(req));
  const audioBuffer = Buffer.from(body.audioBase64, "base64");
  if (audioBuffer.byteLength < 256) {
    return sendJson(res, 400, { error: "A gravacao ficou vazia ou muito curta." });
  }

  const extension = body.mimeType.includes("ogg")
    ? "ogg"
    : body.mimeType.includes("mp4")
      ? "mp4"
      : body.mimeType.includes("wav")
        ? "wav"
        : "webm";

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: body.mimeType }), `command.${extension}`);
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("language", "pt");
  form.append(
    "prompt",
    "Transcricao tecnica em portugues do Brasil sobre data halls, racks, fan walls, corredores, potencia, vazao e dimensoes."
  );

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  });
  const payload = await readOpenAIResponse(response);
  if (!response.ok) {
    return sendJson(res, response.status, {
      error: openAiMessage(payload) || "Nao foi possivel transcrever o audio."
    });
  }

  const text = String((payload as { text?: unknown }).text || "").trim();
  if (!text) return sendJson(res, 422, { error: "Nenhuma fala foi identificada." });
  sendJson(res, 200, { text });
}

async function handleInterpretation(req: IncomingMessage, res: ServerResponse) {
  if (!requireApiKey(res)) return;

  const body = interpretRequestSchema.parse(await readJsonBody(req));
  const instructions = [
    "Voce e o parser tecnico de um modelador parametrico de Data Hall.",
    "Converta a instrucao em JSON estrito no formato {\"message\":\"...\",\"commands\":[...]}",
    "Use somente estes comandos: create_room, resize_room, add_racks, create_rack_rows, add_fan_walls, move_element, rotate_element, set_aisle_width, set_wall_clearance, auto_arrange, delete_element, clear_layout, undo, redo.",
    "Use metros em campos *M, kW em powerKw e m3/h em airflowM3h. Converta milimetros para metros.",
    "Nao use a Realtime API. Nao invente ids se o usuario nao especificar um elemento existente.",
    "Retorne somente JSON valido, sem markdown.",
    `Estado atual: ${JSON.stringify(body.project || {})}`
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
      input: body.text
    })
  });

  const payload = await readOpenAIResponse(response);
  if (!response.ok) {
    return sendJson(res, response.status, {
      error: openAiMessage(payload) || "A IA nao conseguiu interpretar o comando."
    });
  }

  const parsed = parseJsonObject(extractResponseText(payload));
  if (!parsed) {
    return sendJson(res, 502, { error: "A IA retornou uma resposta que nao pode ser interpretada." });
  }

  const result = interpretResponseSchema.safeParse({
    message: parsed.message,
    commands: parsed.commands ?? parsed.actions ?? []
  });
  if (!result.success) {
    return sendJson(res, 422, { error: "A IA retornou comandos fora do contrato esperado." });
  }

  const commands = commandListSchema.parse(result.data.commands);
  sendJson(res, 200, { message: result.data.message, commands });
}

async function serveStatic(pathname: string, res: ServerResponse) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(DIST_DIR, safePath);
  if (!filePath.startsWith(DIST_DIR)) return sendJson(res, 403, { error: "Acesso negado." });

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Arquivo nao encontrado. Execute npm run build antes de npm start." });
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BYTES) {
      const error = new Error("Payload muito grande.");
      (error as Error & { statusCode: number }).statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("JSON invalido.");
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
}

async function readOpenAIResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text || "Resposta invalida da OpenAI." } };
  }
}

function extractResponseText(payload: unknown): string {
  if (payload && typeof payload === "object" && "output_text" in payload) {
    return String((payload as { output_text?: unknown }).output_text || "");
  }
  const parts: string[] = [];
  const output = (payload as { output?: Array<{ content?: Array<{ text?: string }> }> })?.output || [];
  for (const item of output) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function openAiMessage(payload: unknown): string {
  return String((payload as { error?: { message?: unknown } })?.error?.message || "");
}

function requireApiKey(res: ServerResponse): boolean {
  if (OPENAI_API_KEY) return true;
  sendJson(res, 503, { error: "OPENAI_API_KEY nao configurada no servidor." });
  return false;
}

function handleError(res: ServerResponse, error: unknown) {
  if (error instanceof ZodError) {
    return sendJson(res, 400, { error: "Payload invalido.", details: error.flatten() });
  }
  const statusCode = (error as Error & { statusCode?: number })?.statusCode || 500;
  const message = error instanceof Error ? error.message : "Erro interno do servidor.";
  console.error(error);
  sendJson(res, statusCode, { error: message });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function loadDotEnv(filePath: string) {
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
