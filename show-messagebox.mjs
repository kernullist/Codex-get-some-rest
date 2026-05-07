import { spawn } from "node:child_process";

const title = process.env.CODEX_IDLE_MESSAGEBOX_TITLE ?? "Codex";
const message = process.env.CODEX_IDLE_MESSAGEBOX_TEXT ?? "Thank you for your hard work, Codex.";

const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show(
    ${toPowerShellString(message)},
    ${toPowerShellString(title)},
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button1,
    [System.Windows.Forms.MessageBoxOptions]::DefaultDesktopOnly
) | Out-Null
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

function toPowerShellString(value) {
    return `'${String(value).replaceAll("'", "''")}'`;
}
