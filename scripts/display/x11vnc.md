# x11vnc Service Documentation (`x11vnc.sh`)

## Overview

**x11vnc** is a VNC (Virtual Network Computing) server built for the X Window System. Unlike traditional VNC servers (like TightVNC or TigerVNC) that spawn their own separate X session, `x11vnc` is unique because it connects to an **already existing** X11 display (such as the virtual monitor created in memory by Xvfb) and streams its graphical content over the Remote Framebuffer (RFB) protocol.

The [`x11vnc.sh`](x11vnc.sh) script manages the lifecycle (`start`, `stop`, `restart`, `status`) of the VNC service for this project.

---

## Role in the Display Stack

`x11vnc` serves as the bridge between the in-memory X11 desktop and network-based viewers:

```text
1. [xvfb.sh]     ──► Creates virtual X11 display :99 in RAM
2. [x11vnc.sh]   ──► Captures display :99 and exposes VNC on localhost:5900 (RFB protocol)
3. [novnc.sh]    ──► Bridges VNC TCP port 5900 to WebSockets on port 6080 (http://localhost:6080/vnc.html)
4. [Host Browser]──► Renders live interactive UI in your web browser
```

---

## Configuration (`env.sh`)

Configuration is sourced from [`env.sh`](env.sh):

| Variable      | Default Value | Description                                |
| :------------ | :------------ | :----------------------------------------- |
| `DISPLAY_NUM` | `99`          | The X11 display channel to capture (`:99`) |
| `VNC_PORT`    | `5900`        | The TCP port where `x11vnc` listens        |

---

## Command Flags Explained

The command executed inside `x11vnc::start` is:

```bash
x11vnc -display ":${DISPLAY_NUM}" -rfbport "${VNC_PORT}" -nopw -listen localhost -xkb -forever -quiet &
```

| Flag                | Purpose                                                                                                           |
| :------------------ | :---------------------------------------------------------------------------------------------------------------- |
| `-display :99`      | Tells `x11vnc` which X11 screen to capture (matches Xvfb on display `:99`).                                       |
| `-rfbport 5900`     | Specifies the TCP port for the RFB/VNC protocol (default: 5900).                                                  |
| `-nopw`             | Disables password authentication (safe for local containerized development).                                      |
| `-listen localhost` | Restricts raw VNC socket access strictly to `127.0.0.1`, preventing unproxied external access.                    |
| `-xkb`              | Enables the X Keyboard Extension for accurate typing, keyboard layout handling, and modifier keys.                |
| `-forever`          | Keeps the VNC server running across client disconnects (by default, `x11vnc` exits after one client disconnects). |
| `-quiet`            | Suppresses verbose per-frame log output.                                                                          |

---

## Usage

### 1. Command Line Interface (CLI)

Run `x11vnc.sh` directly from the terminal:

```bash
# Start x11vnc (automatically starts Xvfb if not already active)
./scripts/display/x11vnc.sh start

# Check current status and PID
./scripts/display/x11vnc.sh status

# Stop x11vnc
./scripts/display/x11vnc.sh stop

# Restart x11vnc
./scripts/display/x11vnc.sh restart
```

### 2. Sourced as a Bash Library Module

`x11vnc.sh` uses the `x11vnc::` namespace, allowing other orchestrator scripts (like [`display-stack.sh`](display-stack.sh)) to source it safely without function name collisions:

```bash
# shellcheck source=/dev/null
source "./scripts/display/x11vnc.sh"

# Call functions directly
x11vnc::start
x11vnc::status
x11vnc::stop
```

---

## Key Features & Script Design

1. **Automatic Dependency Resolution**:
   If `x11vnc::start` is invoked before `Xvfb` is running, it automatically detects this via `xvfb::is_running` and starts `Xvfb` first.
2. **Socket Readiness Verification**:
   Instead of using an unreliable `sleep 1`, the script actively polls the port with `nc -z localhost 5900` to ensure the server is ready before reporting success.
3. **Scoped Variables**:
   Uses the `_DISPLAY_DIR` private variable convention and `local` inside functions to prevent polluting global shell namespaces when sourced.
4. **Idempotency**:
   Running `x11vnc::start` when the service is already active exits cleanly with an `[OK]` status and does not launch duplicate processes.

---

## Troubleshooting

### Port 5900 Already in Use

If an orphan `x11vnc` process is holding port 5900:

```bash
# Check what is listening on port 5900
lsof -i :5900

# Terminate running x11vnc instances
pkill -9 -x x11vnc
```

### Cannot Open Display `:99`

If `x11vnc` fails with `Cannot open display :99`:

1. Verify that Xvfb is running:

   ```bash
   ./scripts/display/xvfb.sh status
   ```

2. Verify that the UNIX domain socket is present in `/tmp`:

   ```bash
   ls -la /tmp/.X11-unix/X99
   ```
