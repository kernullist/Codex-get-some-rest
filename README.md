# Codex Get Some Rest

Codex Get Some Rest is a small Windows helper for people who give Codex long-running work and then want to go to sleep.

The intended workflow is simple:

1. Ask Codex to do a long task, for example with `/goal`.
2. Start this helper with `npm start`.
3. Go to sleep.
4. When Codex finishes, the helper says:

```text
Thank you for your hard work, Codex.
```

5. After 5 seconds, Windows shuts down.

The point is practical: if Codex is done, the computer does not need to stay awake all night wasting power.

## Install

```powershell
cd C:\git\Codex-get-some-rest
npm install
```

## Use

Start Codex Desktop App, give Codex the long-running task, then run:

```powershell
cd C:\git\Codex-get-some-rest
npm start
```

That is the normal mode. No environment variables are required.

Default behavior:

1. Watch Codex Desktop App session logs.
2. Detect a completed Codex turn.
3. Show `Thank you for your hard work, Codex.`
4. Wait 5 seconds.
5. Shut down Windows.

## Message Box Test

To test only the message box without shutting down:

```powershell
cd C:\git\Codex-get-some-rest
npm run test:message
```

## Dry Run

To test the full watcher without shutting down:

```powershell
cd C:\git\Codex-get-some-rest
$env:CODEX_IDLE_SKIP_SHUTDOWN = "1"
npm start
```

In dry run mode, the message box still appears, but Windows does not shut down.

## How It Works

By default this tool watches Codex Desktop App's local session logs:

```text
%USERPROFILE%\.codex\sessions\**\*.jsonl
```

When it sees a `task_complete` event, it runs the shutdown helper.

The session root is not hardcoded to a specific user. By default it is built from the current user's home directory. You can override it with:

```powershell
$env:CODEX_SESSION_ROOT = "D:\Somewhere\Codex\sessions"
```

## Options

```powershell
$env:CODEX_SESSION_POLL_MS = "1000"
$env:CODEX_IDLE_MESSAGEBOX_TITLE = "Codex"
$env:CODEX_IDLE_MESSAGEBOX_TEXT = "Thank you for your hard work, Codex."
$env:CODEX_IDLE_SHUTDOWN_DELAY_SECONDS = "5"
$env:CODEX_IDLE_SKIP_SHUTDOWN = "1"
```

## App Server Proxy Mode

The watcher can also try the Codex app-server proxy:

```powershell
$env:CODEX_APP_SERVER_TRANSPORT = "desktop-proxy"
npm start
```

On some Windows Desktop App installations this fails with:

```text
failed to connect to socket at ...\.codex\app-server-control\app-server-control.sock
os error 10050
```

The default `session-log` mode avoids that issue.
