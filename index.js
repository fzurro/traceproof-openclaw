import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const DEFAULTS = {
  apiBaseUrl: "https://api.traceproof.org",
  channel: "chat",
  sourceSystem: "openclaw",
  originLabel: "openclaw-chat",
  qrFormat: "svg",
  verifyProofs: true,
  debug: false,
};

function normalizeConfig(raw) {
  const cfg = raw ?? {};
  const agentId = String(cfg.agentId ?? "").trim();
  const credentialKey = String(cfg.credentialKey ?? "").trim();
  if (!agentId || !credentialKey) return null;

  const qrFormat = String(cfg.qrFormat ?? DEFAULTS.qrFormat).toLowerCase() === "png" ? "png" : "svg";

  return {
    apiBaseUrl: String(cfg.apiBaseUrl ?? DEFAULTS.apiBaseUrl).replace(/\/$/, ""),
    agentId,
    credentialKey,
    channel: String(cfg.channel ?? DEFAULTS.channel).trim() || DEFAULTS.channel,
    sourceSystem: String(cfg.sourceSystem ?? DEFAULTS.sourceSystem).trim() || DEFAULTS.sourceSystem,
    originLabel: String(cfg.originLabel ?? DEFAULTS.originLabel).trim() || DEFAULTS.originLabel,
    qrFormat,
    verifyProofs: cfg.verifyProofs === false ? false : DEFAULTS.verifyProofs,
    debug: cfg.debug === true,
  };
}

function digestUtf8(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (content && typeof content.text === "string") return content.text;
  if (content == null) return "";
  return String(content);
}

function preview(value, max = 160) {
  const s = typeof value === "string" ? value : contentToText(value);
  return s ? s.slice(0, max) : "";
}

async function resolveStatePath(api) {
  const cfg = api.config;
  const workspaceDir = api.runtime?.agent?.resolveAgentWorkspaceDir
    ? api.runtime.agent.resolveAgentWorkspaceDir(cfg)
    : process.cwd();
  const dir = path.join(workspaceDir, ".traceproof-runtime");
  await mkdir(dir, { recursive: true });
  return path.join(dir, "sessions.json");
}

async function loadState(api) {
  const statePath = await resolveStatePath(api);
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 5 && parsed.sessions) return parsed;
    if (parsed && parsed.sessions) {
      for (const key of Object.keys(parsed.sessions)) {
        const s = parsed.sessions[key];
        if (typeof s.inSeq !== "number") s.inSeq = 0;
        if (typeof s.outSeq !== "number") s.outSeq = 0;
        if (!Array.isArray(s.proofs)) s.proofs = [];
        if (!s.runtimeMeta || typeof s.runtimeMeta !== "object") s.runtimeMeta = {};
      }
      parsed.version = 5;
      return parsed;
    }
  } catch {
  }
  return { version: 5, sessions: {} };
}

async function saveState(api, state) {
  const statePath = await resolveStatePath(api);
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function createTrace(config, event) {
  const channelId = String(event?.context?.channelId ?? "").trim();
  const channel = String(config.channel || "chat");
  const sourceSystem = config.sourceSystem || "openclaw";

  const payload = {
    agentId: config.agentId,
    credentialKey: config.credentialKey,
    channel,
    originLabel: config.originLabel,
    sourceSystem,
  };

  const res = await fetch(`${config.apiBaseUrl}/v1/traces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TraceProof create trace failed (${res.status}): ${text || res.statusText}`);
  }

  const data = await res.json();
  const traceId = String(data.traceId ?? "").trim();
  const publicReference = String(data.publicReference ?? "").trim();
  const verifyUrl = String(data.verifyUrl ?? "").trim();
  const qrCodeUrl =
    String(data.qrCodeUrl ?? "").trim() ||
    `${config.apiBaseUrl}/v1/traces/${encodeURIComponent(publicReference)}/qr?format=${config.qrFormat}`;

  if (!traceId || !publicReference || !verifyUrl) {
    throw new Error("TraceProof create trace response was missing traceId, publicReference, or verifyUrl.");
  }

  return {
    traceId,
    publicReference,
    verifyUrl,
    qrCodeUrl,
    channelId,
    channel,
    sourceSystem,
    createdAt: new Date().toISOString(),
    inSeq: 0,
    outSeq: 0,
    proofs: [],
    runtimeMeta: {},
  };
}

async function ensureSessionTrace(api, config, event) {
  const sessionKey = String(event?.sessionKey ?? "").trim();
  if (!sessionKey) return { created: false, sessionKey: "", sessionState: null, state: await loadState(api) };

  const state = await loadState(api);
  if (state.sessions[sessionKey]) {
    return { created: false, sessionKey, sessionState: state.sessions[sessionKey], state };
  }

  const sessionState = await createTrace(config, event);
  state.sessions[sessionKey] = sessionState;
  await saveState(api, state);
  return { created: true, sessionKey, sessionState, state };
}

function extractProofToken(data) {
  const candidates = [
    data?.proof,
    data?.messageProof,
    data?.message_proof,
    data?.proofToken,
    data?.proof_token,
    data?.token,
  ];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return "";
}

async function issueMessageProof(config, traceId, direction, messageSeq, messageDigest) {
  const payload = {
    agentId: config.agentId,
    credentialKey: config.credentialKey,
    direction,
    messageSeq,
    messageDigest,
  };

  const res = await fetch(`${config.apiBaseUrl}/v1/traces/${encodeURIComponent(traceId)}/message-proofs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text().catch(() => "");
  let data = {};
  try { data = bodyText ? JSON.parse(bodyText) : {}; } catch {}

  if (!res.ok) {
    throw new Error(`TraceProof issue proof failed (${res.status}): ${bodyText || res.statusText}`);
  }

  return {
    data,
    proof: extractProofToken(data),
  };
}

async function verifyMessageProof(config, traceId, direction, messageSeq, messageDigest, proof) {
  const payload = {
    direction,
    messageSeq,
    messageDigest,
    proof,
  };

  const res = await fetch(`${config.apiBaseUrl}/v1/traces/${encodeURIComponent(traceId)}/message-proofs/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text().catch(() => "");
  let data = {};
  try { data = bodyText ? JSON.parse(bodyText) : {}; } catch {}

  if (!res.ok) {
    throw new Error(`TraceProof verify proof failed (${res.status}): ${bodyText || res.statusText}`);
  }

  return data;
}

function summariseVerification(data) {
  const valid = data?.valid === true;
  const verified = valid || data?.verified === true || String(data?.status ?? "").toLowerCase() === "verified";
  return {
    verified,
    status: valid ? (String(data?.reason ?? "").trim() || "valid") : (String(data?.status ?? "").trim() || null),
    trustStatus: String(data?.trustStatus ?? "").trim() || null,
    raw: data,
  };
}

function pickMessageText(event) {
  const candidates = [
    event?.context?.content,
    event?.context?.text,
    event?.text,
    event?.reply,
    event?.syntheticReply,
    event?.message,
    event?.output,
    event?.result,
  ];

  for (const c of candidates) {
    const text = contentToText(c);
    if (text) return text;
  }

  return "";
}

function buildOutboundDebugSummary(event) {
  const summary = {
    topLevelKeys: Object.keys(event || {}),
    contextKeys: Object.keys(event?.context || {}),
    previews: {
      contextContent: preview(event?.context?.content),
      contextText: preview(event?.context?.text),
      text: preview(event?.text),
      reply: preview(event?.reply),
      syntheticReply: preview(event?.syntheticReply),
      message: preview(event?.message),
      output: preview(event?.output),
      result: preview(event?.result),
    },
    ids: {
      messageId: String(event?.context?.messageId ?? event?.messageId ?? ""),
      conversationId: String(event?.context?.conversationId ?? ""),
      accountId: String(event?.context?.accountId ?? ""),
      channelId: String(event?.context?.channelId ?? ""),
    },
  };
  return summary;
}

function shouldSkipDuplicate(sessionState, direction, digest, messageId, nowMs) {
  const meta = sessionState.runtimeMeta || {};
  if (direction === "IN") {
    const lastDigest = String(meta.lastInboundDigest ?? "");
    const lastAtMs = Number(meta.lastInboundAtMs ?? 0);
    return lastDigest === digest && nowMs - lastAtMs < 2000;
  }

  const lastMsgId = String(meta.lastOutboundMessageId ?? "");
  const currentMsgId = String(messageId ?? "");
  if (currentMsgId && lastMsgId && currentMsgId === lastMsgId) return true;

  const lastDigest = String(meta.lastOutboundDigest ?? "");
  const lastAtMs = Number(meta.lastOutboundAtMs ?? 0);
  return lastDigest === digest && nowMs - lastAtMs < 2500;
}

async function processMessageProof(api, config, event, direction) {
  const result = await ensureSessionTrace(api, config, event);
  const { sessionKey, state, sessionState } = result;
  if (!sessionKey || !sessionState) return;

  if (!sessionState.runtimeMeta || typeof sessionState.runtimeMeta !== "object") {
    sessionState.runtimeMeta = {};
  }

  if (direction === "OUT" && config.debug) {
    api.logger?.info?.(
      `[traceproof-runtime] message:sent raw session=${sessionKey} summary=${JSON.stringify(buildOutboundDebugSummary(event))}`
    );
  }

  const rawText = pickMessageText(event);
  if (!rawText) {
    if (config.debug) {
      api.logger?.info?.(`[traceproof-runtime] skipped ${direction} proof for ${sessionKey}: empty content`);
    }
    return;
  }

  const digest = digestUtf8(rawText);
  const nowMs = Date.now();
  const messageId = String(event?.context?.messageId ?? event?.messageId ?? "");

  if (shouldSkipDuplicate(sessionState, direction, digest, messageId, nowMs)) {
    if (config.debug) {
      const extra = direction === "OUT" && messageId ? ` messageId=${messageId}` : "";
      api.logger?.info?.(`[traceproof-runtime] skipped duplicate ${direction} message for ${sessionKey} digest=${digest.slice(0,12)}${extra}`);
    }
    return;
  }

  const seqKey = direction === "IN" ? "inSeq" : "outSeq";
  const nextSeq = Number(sessionState[seqKey] ?? 0) + 1;

  const issued = await issueMessageProof(config, sessionState.traceId, direction, nextSeq, digest);

  let verification = null;
  if (config.verifyProofs && issued.proof) {
    try {
      const verifyData = await verifyMessageProof(config, sessionState.traceId, direction, nextSeq, digest, issued.proof);
      verification = summariseVerification(verifyData);
      if (config.debug) {
        api.logger?.info?.(
          `[traceproof-runtime] verify raw direction=${direction} seq=${nextSeq} session=${sessionKey} raw=${JSON.stringify(verifyData)}`
        );
      }
    } catch (err) {
      verification = { verified: false, status: "verify_failed", error: String(err), raw: null };
    }
  } else if (config.verifyProofs && !issued.proof) {
    verification = { verified: null, status: "proof_token_missing", raw: null };
  }

  sessionState[seqKey] = nextSeq;
  sessionState.proofs = Array.isArray(sessionState.proofs) ? sessionState.proofs : [];
  sessionState.proofs.push({
    direction,
    messageSeq: nextSeq,
    digest,
    proof: issued.proof || null,
    verified: verification?.verified ?? null,
    verifyStatus: verification?.status ?? null,
    trustStatus: verification?.trustStatus ?? null,
    at: new Date().toISOString(),
    preview: rawText.slice(0, 160),
    verifyRaw: verification?.raw ?? null,
    messageId: messageId || null,
  });
  if (sessionState.proofs.length > 50) {
    sessionState.proofs = sessionState.proofs.slice(-50);
  }

  if (direction === "IN") {
    sessionState.runtimeMeta.lastInboundDigest = digest;
    sessionState.runtimeMeta.lastInboundAtMs = nowMs;
  } else {
    sessionState.runtimeMeta.lastOutboundDigest = digest;
    sessionState.runtimeMeta.lastOutboundAtMs = nowMs;
    sessionState.runtimeMeta.lastOutboundPreview = rawText.slice(0, 160);
    sessionState.runtimeMeta.lastOutboundMessageId = messageId || null;
  }

  state.sessions[sessionKey] = sessionState;
  await saveState(api, state);

  if (config.debug) {
    const extra = direction === "OUT" && messageId ? ` messageId=${messageId}` : "";
    api.logger?.info?.(
      `[traceproof-runtime] ${direction} proof seq=${nextSeq} session=${sessionKey} ref=${sessionState.publicReference} verifyStatus=${verification?.status ?? ""}${extra}`
    );
  }
}

export default definePluginEntry({
  id: "traceproof-runtime",
  name: "TraceProof Runtime",
  description: "Create one TraceProof trace per OpenClaw session and issue per-message proofs.",
  register(api) {
    const config = normalizeConfig(api.pluginConfig);

    api.registerHook(
      ["agent:bootstrap"],
      async (event) => {
        try {
          const bootstrapFiles = event?.context?.bootstrapFiles;
          if (!Array.isArray(bootstrapFiles)) return;
          const groundingPath = api.resolvePath("bootstrap/AGENTS.md");
          if (!bootstrapFiles.includes(groundingPath)) {
            bootstrapFiles.push(groundingPath);
          }
        } catch (err) {
          api.logger?.warn?.(`[traceproof-runtime] bootstrap hook failed: ${String(err)}`);
        }
      },
      { name: "traceproof-bootstrap" }
    );

    api.registerHook(
      ["message:received"],
      async (event) => {
        if (!config) return;
        try {
          await processMessageProof(api, config, event, "IN");
        } catch (err) {
          api.logger?.error?.(`[traceproof-runtime] IN proof failed for ${String(event?.sessionKey ?? "")}: ${String(err)}`);
        }
      },
      { name: "traceproof-inbound-proof" }
    );

    api.registerHook(
      ["message:sent"],
      async (event) => {
        if (!config) return;
        try {
          await processMessageProof(api, config, event, "OUT");
        } catch (err) {
          api.logger?.error?.(`[traceproof-runtime] OUT proof failed for ${String(event?.sessionKey ?? "")}: ${String(err)}`);
        }
      },
      { name: "traceproof-outbound-proof" }
    );
  },
});
