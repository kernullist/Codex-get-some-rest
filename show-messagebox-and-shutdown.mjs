import { spawn } from "node:child_process";

const title = process.env.CODEX_IDLE_MESSAGEBOX_TITLE ?? "Codex";
const message = process.env.CODEX_IDLE_MESSAGEBOX_TEXT ?? "Thank you for your hard work, Codex.";
const shutdownDelaySeconds = parsePositiveInteger(process.env.CODEX_IDLE_SHUTDOWN_DELAY_SECONDS, 5);
const skipShutdown = process.env.CODEX_IDLE_SKIP_SHUTDOWN === "1";

const script = `
$shell = New-Object -ComObject WScript.Shell
$shell.Popup(
    ${toPowerShellString(message)},
    ${shutdownDelaySeconds},
    ${toPowerShellString(title)},
    64
) | Out-Null
if (${skipShutdown ? "$true" : "$false"}) {
    exit 0
}
shutdown.exe /s /t 0
`;

const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    stdio: "inherit",
    windowsHide: true
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 1);
});

child.on("error", (err) => {
    console.error(err);
    process.exit(1);
});

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value ?? "", 10);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return parsed;
}

function toPowerShellString(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}
