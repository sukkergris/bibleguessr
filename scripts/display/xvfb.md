# Xvfb Service Documentation (`xvfb.sh`)

## Overview

**Xvfb** (**X** **V**irtual **F**rame**B**uffer) is an in-memory display server implementing the X11 display server protocol. It enables graphical applications (such as Chromium, Firefox, WebKit, and Playwright) to run in environments without a physical monitor or graphics card (e.g., Docker containers, DevContainers, CI/CD runners).

The [`xvfb.sh`](xvfb.sh) script provides lifecycle management (`start`, `stop`, `restart`, `status`) for the virtual screen in this project.

---

## Why Xvfb is Needed

Inside a Docker container, there is no physical display attached. When running browser automation in headed mode (e.g., `playwright codegen`, visual debugging, or headed tests), browsers require an active `$DISPLAY` to render windows, compute layouts, and draw UI elements.

Without an X server running, launching a headed browser fails with:

```text
Error: Target page, context or browser has been closed (Missing X server or $DISPLAY)
```

Xvfb creates a virtual display (by default `:99`) entirely in RAM where browsers can render normally.

---

## Role in the Display Stack

Xvfb forms the foundation of the local display pipeline:

```text
1. [xvfb.sh]     ──► Creates virtual X11 display :99 in RAM
2. [x11vnc.sh]   ──► Captures display :99 and exposes VNC on port 5900
3. [novnc.sh]    ──► Bridges VNC to WebSockets on port 6080 (http://localhost:6080/vnc.html)
4. [Playwright]  ──► Runs with DISPLAY=:99 to draw windows onto the virtual display
```

---

## Configuration (`env.sh`)

Configuration is sourced from [`env.sh`](env.sh):

| Variable      | Default Value                    | Description                                      |
| :------------ | :------------------------------- | :----------------------------------------------- |
| `DISPLAY_NUM` | `99`                             | X11 display number (accessible as `DISPLAY=:99`) |
| `SCREEN_RES`  | `"1920x1080x24"`                 | Screen resolution: width × height × color depth  |
| `SOCKET_PATH` | `/tmp/.X11-unix/X${DISPLAY_NUM}` | Unix domain socket used by X11 clients           |

---

## Usage

### 1. Command Line Interface (CLI)

Run `xvfb.sh` directly from the terminal:

```bash
# Start Xvfb (idempotent — will not start duplicate processes)
./scripts/display/xvfb.sh start

# Check current status and PID
./scripts/display/xvfb.sh status

# Stop Xvfb and clean up sockets/locks
./scripts/display/xvfb.sh stop

# Restart Xvfb
./scripts/display/xvfb.sh restart
```

### 2. Sourced as a Bash Library Module

`xvfb.sh` uses the `xvfb::` namespace, allowing other scripts (like [`display-stack.sh`](display-stack.sh)) to source it safely without function name collisions:

```bash
# shellcheck source=/dev/null
source "./scripts/display/xvfb.sh"

# Call functions directly
xvfb::start
xvfb::status
xvfb::stop
```

---

## Available Functions

- `xvfb::is_running`: Returns `0` if an Xvfb process is active, `1` otherwise.
- `xvfb::status`: Logs the current state, PID, and display number using `lib-bash` logging.
- `xvfb::start`:
  1. Checks if Xvfb is already running.
  2. Cleans up any stale socket or lock files from prior crashes (`/tmp/.X11-unix/X<NUM>`, `/tmp/.X<NUM>-lock`).
  3. Launches `Xvfb :<DISPLAY_NUM> -screen 0 <SCREEN_RES> &`.
  4. Polls for the UNIX domain socket (`/tmp/.X11-unix/X<DISPLAY_NUM>`) to guarantee the server is ready before returning.
- `xvfb::stop`: Sends `SIGTERM` (and `SIGKILL` if needed after timeout) to Xvfb and removes leftover lock files.
- `xvfb::restart`: Sequences `xvfb::stop` followed by `xvfb::start`.

---

## Running Playwright with Xvfb

Once Xvfb is running, point any GUI or Playwright command to the display:

```bash
# Start display
./scripts/display/xvfb.sh start

# Run Playwright in headed mode on the virtual screen
DISPLAY=:99 npx --prefix e2e playwright test --headed

# Run Playwright CLI on the virtual screen
DISPLAY=:99 playwright-cli open http://localhost:5252
```

---

## Troubleshooting

### Stale Lock File

If Xvfb is killed abruptly (e.g. container stop or crash), lock files may remain in `/tmp/`:

- Socket: `/tmp/.X11-unix/X99`
- Lock: `/tmp/.X99-lock`

`xvfb::start` automatically detects and clears stale locks if no active Xvfb process is attached to them.

### Verifying Display Health Manually

You can verify that the virtual display is active using `xdpyinfo`:

```bash
DISPLAY=:99 xdpyinfo
```
