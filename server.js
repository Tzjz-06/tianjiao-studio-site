import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = parsePort(process.env.PORT, 8787);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.resolve(ROOT_DIR, process.env.DATA_DIR || "./data");
const DATA_FILE = path.join(DATA_DIR, "inquiries.json");
const MAX_BODY_BYTES = parsePort(process.env.MAX_BODY_BYTES, 20_000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() || "";
const NODE_ENV = process.env.NODE_ENV || "development";
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 8;
const requestLog = new Map();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const STATUS_VALUES = new Set(["new", "contacted", "closed"]);

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

class HttpError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, code, message, details = undefined) {
  sendJson(response, statusCode, {
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function getClientAddress(request) {
  return request.socket.remoteAddress || "unknown";
}

function isRateLimited(address) {
  const now = Date.now();
  const current = requestLog.get(address);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    requestLog.set(address, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT;
}

async function readInquiries() {
  try {
    const contents = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(contents);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeInquiries(inquiries) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(inquiries, null, 2)}\n`, "utf8");
  await fs.rename(temporaryFile, DATA_FILE);
}

let writeQueue = Promise.resolve();

function updateInquiries(mutator) {
  const operation = writeQueue.then(async () => {
    const inquiries = await readInquiries();
    const result = await mutator(inquiries);
    await writeInquiries(inquiries);
    return result;
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

async function readRequestBody(request) {
  const contentLength = Number.parseInt(request.headers["content-length"] || "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "提交内容超过大小限制。");
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += Buffer.byteLength(chunk);
    if (totalBytes > MAX_BODY_BYTES) {
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "提交内容超过大小限制。");
    }
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) throw new HttpError(400, "EMPTY_BODY", "请求内容不能为空。");
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "请求内容不是有效的 JSON。");
  }
}

function validateInquiry(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "INVALID_PAYLOAD", "提交内容格式不正确。");
  }
  if (normalizeText(payload.website)) {
    throw new HttpError(400, "SPAM_REJECTED", "提交未通过校验。");
  }

  const input = {
    name: normalizeText(payload.name),
    contact: normalizeText(payload.contact),
    message: normalizeText(payload.message),
  };
  const errors = {};
  if (input.name.length < 2 || input.name.length > 80) errors.name = "称呼需要 2 到 80 个字符。";
  if (input.contact.length < 3 || input.contact.length > 120) errors.contact = "联系方式需要 3 到 120 个字符。";
  if (input.message.length < 10 || input.message.length > 2_000) errors.message = "想法需要 10 到 2000 个字符。";
  if (Object.keys(errors).length > 0) {
    throw new HttpError(422, "VALIDATION_FAILED", "请检查表单内容。", errors);
  }
  return input;
}

function requireAdmin(request) {
  if (!ADMIN_TOKEN) {
    throw new HttpError(503, "ADMIN_NOT_CONFIGURED", "管理接口未配置 ADMIN_TOKEN，请先设置环境变量。");
  }
  if (request.headers["x-admin-token"] !== ADMIN_TOKEN) {
    throw new HttpError(401, "UNAUTHORIZED", "管理令牌无效。");
  }
}

function parsePagination(searchParams) {
  const limitValue = Number.parseInt(searchParams.get("limit") || "50", 10);
  const offsetValue = Number.parseInt(searchParams.get("offset") || "0", 10);
  return {
    limit: Math.min(Math.max(Number.isFinite(limitValue) ? limitValue : 50, 1), 100),
    offset: Math.max(Number.isFinite(offsetValue) ? offsetValue : 0, 0),
  };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      service: "tianjiao-studio-site",
      environment: NODE_ENV,
      time: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/inquiries") {
    if (isRateLimited(getClientAddress(request))) {
      sendError(response, 429, "RATE_LIMITED", "提交过于频繁，请稍后再试。");
      return;
    }
    const inquiry = {
      id: randomUUID(),
      ...validateInquiry(await readRequestBody(request)),
      status: "new",
      createdAt: new Date().toISOString(),
      source: "website-contact-form",
    };
    await updateInquiries((inquiries) => {
      inquiries.unshift(inquiry);
      return inquiry;
    });
    sendJson(response, 201, { ok: true, inquiry: { id: inquiry.id, createdAt: inquiry.createdAt } });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/inquiries") {
    requireAdmin(request);
    const { limit, offset } = parsePagination(url.searchParams);
    const status = url.searchParams.get("status");
    if (status && !STATUS_VALUES.has(status)) {
      throw new HttpError(400, "INVALID_STATUS", "状态值不正确。");
    }
    const allInquiries = await readInquiries();
    const filtered = status ? allInquiries.filter((item) => item.status === status) : allInquiries;
    sendJson(response, 200, {
      ok: true,
      total: filtered.length,
      items: filtered.slice(offset, offset + limit),
      pagination: { limit, offset },
    });
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/inquiries\/([^/]+)$/);
  if (request.method === "PATCH" && statusMatch) {
    requireAdmin(request);
    const status = (await readRequestBody(request))?.status;
    if (typeof status !== "string" || !STATUS_VALUES.has(status)) {
      throw new HttpError(422, "INVALID_STATUS", "状态只能是 new、contacted 或 closed。");
    }
    const inquiryId = decodeURIComponent(statusMatch[1]);
    const updatedInquiry = await updateInquiries((inquiries) => {
      const inquiry = inquiries.find((item) => item.id === inquiryId);
      if (!inquiry) throw new HttpError(404, "NOT_FOUND", "找不到这条咨询记录。");
      inquiry.status = status;
      inquiry.updatedAt = new Date().toISOString();
      return inquiry;
    });
    sendJson(response, 200, { ok: true, inquiry: updatedInquiry });
    return;
  }

  throw new HttpError(404, "NOT_FOUND", "接口不存在。");
}

async function serveStatic(response, url) {
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(ROOT_DIR, `.${requestedPath}`);
  if (filePath !== ROOT_DIR && !filePath.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new HttpError(403, "FORBIDDEN", "不允许访问该路径。");
  }
  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    throw new HttpError(404, "NOT_FOUND", "页面不存在。");
  }
  if (!stats.isFile()) throw new HttpError(404, "NOT_FOUND", "页面不存在。");
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Cache-Control": extension === ".mp4" ? "public, max-age=86400" : "no-cache",
    "Content-Length": stats.size,
  });
  response.end(await fs.readFile(filePath));
}

const server = createServer(async (request, response) => {
  setSecurityHeaders(response);
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "不支持该请求方法。");
    }
    await serveStatic(response, url);
  } catch (error) {
    if (error instanceof HttpError) {
      sendError(response, error.statusCode, error.code, error.message, error.details);
      return;
    }
    console.error("[server-error]", error);
    sendError(response, 500, "INTERNAL_ERROR", "服务暂时不可用，请稍后再试。");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[tianjiao] website: http://${HOST}:${PORT}`);
  console.log(`[tianjiao] health:  http://${HOST}:${PORT}/api/health`);
  if (!ADMIN_TOKEN) console.warn("[tianjiao] ADMIN_TOKEN 未配置，管理接口将返回 503。");
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
