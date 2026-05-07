import WebSocket from "ws";
import { spawn } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const appServerUrl = process.env.CODEX_APP_SERVER_URL ?? "ws://127.0.0.1:47777";
const transport = process.env.CODEX_APP_SERVER_TRANSPORT ?? "session-log";
const hookCommand = process.env.ON_CODEX_IDLE_COMMAND ?? defaultNodeCommand();
const hookArgs = parseHookArgs(process.env.ON_CODEX_IDLE_ARGS ?? ".\\show-messagebox-and-shutdown.mjs");
const waitForIdleMs = parsePositiveInteger(process.env.CODEX_IDLE_WAIT_MS, 30000);
const reconnectMs = parsePositiveInteger(process.env.CODEX_RECONNECT_MS, 2000);
const sessionPollMs = parsePositiveInteger(process.env.CODEX_SESSION_POLL_MS, 1000);
const sessionRoot = process.env.CODEX_SESSION_ROOT ?? path.join(os.homedir(), ".codex", "sessions");
const proxyFallback = (process.env.CODEX_DESKTOP_PROXY_FALLBACK ?? "session-log") !== "off";
const proxyCommand = process.env.CODEX_APP_SERVER_PROXY_COMMAND ?? defaultProxyCommand();
const proxyArgs = process.env.CODEX_APP_SERVER_PROXY_ARGS
    ? parseHookArgs(process.env.CODEX_APP_SERVER_PROXY_ARGS)
    : defaultProxyArgs();

let nextRequestId = 1;
let reconnectTimer = null;
const pendingTurns = new Map();
const handledTurns = new Set();
let sessionLogStarted = false;

if (transport === "desktop-proxy") {
    connectDesktopProxy();
}
else if (transport === "ws") {
    connectWebSocket();
}
else if (transport === "session-log") {
    startSessionLogWatcher();
}
else {
    console.error(`unsupported CODEX_APP_SERVER_TRANSPORT: ${transport}`);
    process.exit(1);
}

function connectWebSocket() {
    const ws = new WebSocket(appServerUrl);

    ws.on("open", () => {
        console.log(`connected: ${appServerUrl}`);
        sendInitialize((request) => {
            ws.send(JSON.stringify(request));
        });
    });

    ws.on("message", (data) => {
        handleMessage(data);
    });

    ws.on("close", () => {
        console.error("connection closed");
        scheduleReconnect();
    });

    ws.on("error", (err) => {
        console.error(`connection error: ${err.message}`);
    });
}

function sendInitialize(ws) {
    const request = {
        id: nextRequestId++,
        method: "initialize",
        params: {
            clientInfo: {
                name: "codex-idle-hook",
                title: "Codex Idle Hook",
                version: "0.1.0"
            },
            capabilities: {
                experimentalApi: true,
                optOutNotificationMethods: []
            }
        }
    };

    ws(request);
}

function connectDesktopProxy() {
    const child = spawn(proxyCommand, proxyArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
    });

    const stdout = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity
    });

    const stderr = readline.createInterface({
        input: child.stderr,
        crlfDelay: Infinity
    });

    child.on("spawn", () => {
        console.log(`connected through desktop proxy: ${proxyCommand} ${proxyArgs.join(" ")}`);
        sendInitialize((request) => {
            child.stdin.write(`${JSON.stringify(request)}\n`);
        });
    });

    child.on("exit", (code, signal) => {
        console.error(`desktop proxy exited: code=${code ?? ""} signal=${signal ?? ""}`);

        if (proxyFallback) {
            console.error("desktop proxy unavailable, falling back to session log watcher");
            startSessionLogWatcher();
            return;
        }

        scheduleReconnect();
    });

    child.on("error", (err) => {
        console.error(`desktop proxy error: ${err.message}`);
    });

    stdout.on("line", (line) => {
        handleMessage(line);
    });

    stderr.on("line", (line) => {
        if (line.trim()) {
            console.error(`proxy: ${line}`);
        }
    });
}

function handleMessage(data) {
    let msg = null;

    try {
        msg = JSON.parse(data.toString());
    }
    catch {
        return;
    }

    if (msg.method === "turn/completed") {
        handleTurnCompleted(msg.params);
    }
    else if (msg.method === "thread/status/changed") {
        handleThreadStatusChanged(msg.params);
    }
}

function handleTurnCompleted(params) {
    const threadId = params?.threadId;
    const turn = params?.turn;

    if (!threadId || !turn?.id) {
        return;
    }

    if (turn.status !== "completed") {
        console.log(`ignored turn ${turn.id}: status=${turn.status}`);
        return;
    }

    if (handledTurns.has(turn.id)) {
        return;
    }

    clearPendingTurn(turn.id);

    const timeout = setTimeout(() => {
        pendingTurns.delete(turn.id);
        console.error(`idle wait timed out: thread=${threadId} turn=${turn.id}`);
    }, waitForIdleMs);

    pendingTurns.set(turn.id, {
        threadId,
        turnId: turn.id,
        timeout
    });

    console.log(`turn completed, waiting for idle: thread=${threadId} turn=${turn.id}`);
}

function handleThreadStatusChanged(params) {
    const threadId = params?.threadId;
    const statusType = params?.status?.type;

    if (!threadId || statusType !== "idle") {
        return;
    }

    for (const pending of pendingTurns.values()) {
        if (pending.threadId === threadId) {
            runHookOnce(pending);
        }
    }
}

function runHookOnce(pending) {
    if (handledTurns.has(pending.turnId)) {
        clearPendingTurn(pending.turnId);
        return;
    }

    handledTurns.add(pending.turnId);
    clearPendingTurn(pending.turnId);

    const child = spawn(hookCommand, hookArgs, {
        detached: true,
        stdio: "ignore",
        windowsHide: true
    });

    child.unref();
    console.log(`started hook: thread=${pending.threadId} turn=${pending.turnId}`);
}

function runHookFromSessionLog(event) {
    const turnId = event.turnId ?? event.id;

    if (!turnId) {
        return;
    }

    if (handledTurns.has(turnId)) {
        return;
    }

    handledTurns.add(turnId);

    const child = spawn(hookCommand, hookArgs, {
        detached: true,
        stdio: "ignore",
        windowsHide: true
    });

    child.unref();
    console.log(`started hook from session log: turn=${turnId}`);
}

function clearPendingTurn(turnId) {
    const pending = pendingTurns.get(turnId);

    if (!pending) {
        return;
    }

    clearTimeout(pending.timeout);
    pendingTurns.delete(turnId);
}

function scheduleReconnect() {
    if (reconnectTimer) {
        return;
    }

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (transport === "desktop-proxy") {
            connectDesktopProxy();
        }
        else {
            connectWebSocket();
        }
    }, reconnectMs);
}

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value ?? "", 10);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return parsed;
}

function parseHookArgs(value) {
    if (!value.trim()) {
        return [];
    }

    const args = [];
    let current = "";
    let quote = null;

    for (let index = 0; index < value.length; index++) {
        const ch = value[index];

        if ((ch === "\"" || ch === "'") && quote === null) {
            quote = ch;
            continue;
        }

        if (ch === quote) {
            quote = null;
            continue;
        }

        if (/\s/.test(ch) && quote === null) {
            if (current) {
                args.push(current);
                current = "";
            }

            continue;
        }

        current += ch;
    }

    if (current) {
        args.push(current);
    }

    return args;
}

function startSessionLogWatcher() {
    if (sessionLogStarted) {
        return;
    }

    sessionLogStarted = true;
    console.log(`watching session logs: ${sessionRoot}`);

    const offsets = new Map();

    const tick = async () => {
        try {
            const files = await listJsonlFiles(sessionRoot);

            for (const file of files) {
                await readNewSessionLines(file, offsets);
            }
        }
        catch (err) {
            console.error(`session log watcher error: ${err.message}`);
        }
        finally {
            setTimeout(tick, sessionPollMs);
        }
    };

    tick();
}

async function listJsonlFiles(root) {
    const files = [];
    const stack = [root];

    while (stack.length > 0) {
        const current = stack.pop();
        let entries = [];

        try {
            entries = await fsp.readdir(current, { withFileTypes: true });
        }
        catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);

            if (entry.isDirectory()) {
                stack.push(fullPath);
            }
            else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
                files.push(fullPath);
            }
        }
    }

    return files;
}

async function readNewSessionLines(file, offsets) {
    const stat = await fsp.stat(file);
    const known = offsets.get(file);

    if (known === undefined) {
        offsets.set(file, stat.size);
        return;
    }

    if (stat.size <= known) {
        offsets.set(file, stat.size);
        return;
    }

    const stream = fs.createReadStream(file, {
        encoding: "utf8",
        start: known,
        end: stat.size - 1
    });

    let buffer = "";

    for await (const chunk of stream) {
        buffer += chunk;
    }

    offsets.set(file, stat.size);

    for (const line of buffer.split(/\r?\n/)) {
        handleSessionLine(line);
    }
}

function handleSessionLine(line) {
    if (!line.trim()) {
        return;
    }

    let event = null;

    try {
        event = JSON.parse(line);
    }
    catch {
        return;
    }

    if (event.type !== "event_msg") {
        return;
    }

    const payload = event.payload;

    if (payload?.type !== "task_complete") {
        return;
    }

    runHookFromSessionLog({
        turnId: payload.turn_id,
        completedAt: payload.completed_at
    });
}

function defaultProxyCommand() {
    if (process.platform === "win32") {
        return "cmd.exe";
    }

    return "codex";
}

function defaultProxyArgs() {
    if (process.platform === "win32") {
        return ["/d", "/s", "/c", "codex app-server proxy"];
    }

    return ["app-server", "proxy"];
}

function defaultNodeCommand() {
    if (process.platform === "win32") {
        return "node.exe";
    }

    return "node";
}
