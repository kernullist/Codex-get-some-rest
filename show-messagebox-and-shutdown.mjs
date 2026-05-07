import { spawn } from "node:child_process";

const title = process.env.CODEX_IDLE_MESSAGEBOX_TITLE ?? "Codex";
const message = process.env.CODEX_IDLE_MESSAGEBOX_TEXT ?? "Thank you for your hard work, Codex.";
const shutdownDelaySeconds = parsePositiveInteger(process.env.CODEX_IDLE_SHUTDOWN_DELAY_SECONDS, 5);
const skipShutdown = process.env.CODEX_IDLE_SKIP_SHUTDOWN === "1";

const child = spawnMessageAndShutdown(title, message, shutdownDelaySeconds, skipShutdown);

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

function spawnMessageAndShutdown(titleText, messageText, delaySeconds, dryRun) {
    if (process.platform === "win32") {
        return spawnWindowsMessageAndShutdown(titleText, messageText, delaySeconds, dryRun);
    }

    if (process.platform === "darwin") {
        return spawnMacMessageAndShutdown(titleText, messageText, delaySeconds, dryRun);
    }

    console.error(`Unsupported platform for shutdown: ${process.platform}`);
    process.exit(1);
}

function spawnWindowsMessageAndShutdown(titleText, messageText, delaySeconds, dryRun) {
    const script = `
$shell = New-Object -ComObject WScript.Shell
$shell.Popup(
    ${toPowerShellString(messageText)},
    ${delaySeconds},
    ${toPowerShellString(titleText)},
    64
) | Out-Null
if (${dryRun ? "$true" : "$false"}) {
    exit 0
}
shutdown.exe /s /t 0
`;

    return spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
        stdio: "inherit",
        windowsHide: true
    });
}

function spawnMacMessageAndShutdown(titleText, messageText, delaySeconds, dryRun) {
    const lines = [
        [
            "display dialog",
            toAppleScriptString(messageText),
            "with title",
            toAppleScriptString(titleText),
            "buttons {\"OK\"}",
            "default button \"OK\"",
            "giving up after",
            String(delaySeconds)
        ].join(" ")
    ];

    if (!dryRun) {
        lines.push("tell application \"System Events\" to shut down");
    }

    return spawn("osascript", lines.flatMap((line) => ["-e", line]), {
        stdio: "inherit"
    });
}

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

function toAppleScriptString(value) {
    return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
