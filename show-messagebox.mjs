import { spawn } from "node:child_process";

const title = process.env.CODEX_IDLE_MESSAGEBOX_TITLE ?? "Codex";
const message = process.env.CODEX_IDLE_MESSAGEBOX_TEXT ?? "Thank you for your hard work, Codex.";

const child = spawnMessageBox(title, message);

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

function spawnMessageBox(titleText, messageText) {
    if (process.platform === "win32") {
        return spawnWindowsMessageBox(titleText, messageText);
    }

    if (process.platform === "darwin") {
        return spawnMacMessageBox(titleText, messageText);
    }

    console.error(`Unsupported platform for message box: ${process.platform}`);
    process.exit(1);
}

function spawnWindowsMessageBox(titleText, messageText) {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show(
    ${toPowerShellString(messageText)},
    ${toPowerShellString(titleText)},
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
    [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly
) | Out-Null
`;

    return spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
        stdio: "inherit",
        windowsHide: true
    });
}

function spawnMacMessageBox(titleText, messageText) {
    const script = [
        "display dialog",
        toAppleScriptString(messageText),
        "with title",
        toAppleScriptString(titleText),
        "buttons {\"OK\"}",
        "default button \"OK\""
    ].join(" ");

    return spawn("osascript", ["-e", script], {
        stdio: "inherit"
    });
}

function toPowerShellString(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}

function toAppleScriptString(value) {
    return `"${String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
