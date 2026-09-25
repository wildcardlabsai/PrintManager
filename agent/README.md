# PrintFlow Printer Agent

Connects Flashforge **AD5X** and **Adventurer 5M** printers on your local network to PrintFlow.

PrintFlow runs in the cloud and cannot reach printers on your network. The agent runs on a computer
that can (a Windows PC, Mac or Linux box on the same network), talks to the printers with
**Flashforge's own network library**, and makes outgoing HTTPS requests to PrintFlow. PrintFlow never
connects to the agent.

> **Status:** the agent has been tested against a simulated printer (mock mode) and against a test
> double of Flashforge's library compiled from its official header. It has **not yet been tested
> against a physical AD5X or Adventurer 5M.** Work through the live test checklist in PrintFlow
> (Printers → the printer) with someone at the printer before relying on it.

## How it talks to the printer

Flashforge's LAN interface is the `FlashNetwork` library that ships with Flashforge's
[Orca-Flashforge](https://github.com/FlashForge/Orca-Flashforge) slicer
(`FlashNetwork.dll` / `libFlashNetwork.dylib` / `libFlashNetwork.so`). Its LAN functions take the
printer's IP address, port, **serial number** and **check code**, which is how Orca-Flashforge
itself connects in LAN mode. The agent calls only these functions:

| Library call | Used for |
| --- | --- |
| `fnet_getLanDevList` | `printflow-agent discover`, finding a printer whose IP changed |
| `fnet_getLanDevProduct` | connection test |
| `fnet_getLanDevDetail` | status, temperatures, progress, filament/IFS slots, firmware, errors |
| `fnet_lanDevSendGcode` (print now) | send a verified sliced file and start it |
| `fnet_ctrlLanDevJob` (`pause` / `continue` / `cancel`) | pause, resume, stop — only for the job PrintFlow expects |
| `fnet_ctrlLanDevState` (`setClearPlatform`) | tell the printer the plate was cleared (optional, after a finished print) |

Nothing else is exposed: no temperature/fan/motion control, no firmware updates, no cloud (WAN)
functions, and no way for PrintFlow to run arbitrary commands on this computer. PrintFlow does not
ship or modify Flashforge's library; the agent loads the copy from your Orca-Flashforge installation.
Check Flashforge's licence terms for that component.

## Install

Requires Node.js 20 or newer.

```bash
cd agent
npm install        # installs koffi (FFI) and TypeScript
npm run build
npm link           # optional: puts `printflow-agent` on your PATH (otherwise use `node dist/cli.js`)
```

Install **Orca-Flashforge** on the same computer. The agent looks for the library in the default
install location:

- Windows: `C:\Program Files\Orca-Flashforge\FlashNetwork.dll` and `resources\data\FLASHNETWORK7.DAT`
- macOS: `/Applications/Orca-Flashforge.app/Contents/MacOS/libFlashNetwork.dylib` and `../Resources/data/FLASHNETWORK7.DAT`
- Linux (AppImage): extract it (`--appimage-extract`) and point the agent at the files:

```bash
printflow-agent set-library --library /path/to/libFlashNetwork.so --settings /path/to/resources/data/FLASHNETWORK7.DAT
```

## Set up

1. **On each printer:** Settings → Network → turn on **LAN mode**. Note the **serial number** and the
   **check code** (shown as "Printer ID" / check code in the network mode screen).
2. **In PrintFlow:** Printers → Printer Agents → *Add Printer Agent*. Copy the pairing command.
3. **On this computer:**

   ```bash
   printflow-agent pair --server https://your-printflow.example --code ABCD-EFGH-JKLM
   printflow-agent set-check-code SNXXXXXXXX        # prompts for the check code
   printflow-agent discover                         # lists printers on the network (serial, IP, port)
   printflow-agent run
   ```

4. **In PrintFlow:** open the printer → *Connection settings* → choose *Printer Agent — Flashforge
   LAN*, pick the agent, enter the serial number (IP and port are optional: discovery fills them in).
5. Work through the printer's **live test checklist**, including a small supervised test print.
   PrintFlow won't send production jobs to the printer until an admin marks it verified.

Run the agent as a service so it survives reboots (Task Scheduler on Windows, `launchd` on macOS,
a `systemd` unit on Linux) with `printflow-agent run` as the command.

## Security

- **Pairing:** one-time code, valid 15 minutes, stored hashed in PrintFlow.
- **Token:** a random 256-bit bearer token, stored hashed in PrintFlow and in the agent's config file
  (`~/.printflow-agent/config.json`, or `PRINTFLOW_AGENT_CONFIG`), which is written with owner-only
  permissions (0600). It **rotates weekly**; the previous token keeps working until the agent has
  used the new one. **Revoke** or **Re-pair** in PrintFlow invalidates it immediately; the agent then
  stops with exit code 2.
- **Check codes** stay in the local config file. They are never sent to PrintFlow.
- **Commands** are a fixed whitelist (start a file, pause, resume, stop, status check, connection
  test, clear plate). Unknown commands are rejected. Start commands expire if not picked up in time
  (default 2 minutes) so a print never starts late.
- **Files** are downloaded from a short-lived signed link, checked against their SHA-256 and size,
  sent to the printer, then deleted.
- The agent only ever makes outgoing HTTPS requests; `http://` is allowed for `localhost` only.

## Mock mode (development and testing)

```bash
printflow-agent pair --server http://localhost:3000 --code … --mock
```

Mock mode simulates the printers PrintFlow configures (heating → printing → completed, pause,
resume, stop, errors). Everything it reports is labelled **simulated** in PrintFlow, and simulated
checklist ticks are discarded when a real printer connects. Set `"mock": { "controlPort": 4455 }` in
the config to control the simulator from tests (`POST http://127.0.0.1:4455/printers/<serial>/<action>`
with `offline`, `online`, `error`, `clear_error`, `finish`, `cancel_at_printer`, `fail_next_send`,
`reset`).

## Commands

| Command | |
| --- | --- |
| `pair --server <url> --code <code> [--name <name>] [--mock]` | Pair with PrintFlow |
| `set-check-code <serial> [code]` / `remove-check-code <serial>` | Manage local check codes |
| `set-library --library <path> --settings <path>` | FlashNetwork library location |
| `discover` | Flashforge printers answering on this network |
| `status` | Configuration with secrets hidden |
| `run` | Start the agent |
