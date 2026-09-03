# noVNC & websockify Documentation (`novnc.sh`)

## The Big Picture (Start Here!)

If you are running in a DevContainer or remote server, you have three layers working together:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        HOW IT ALL FITS TOGETHER                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  1. Xvfb (xvfb.sh)                                                     │
│     Creates an INVISIBLE virtual monitor in RAM (DISPLAY=:99).         │
│                                                                        │
│  2. x11vnc (x11vnc.sh)                                                 │
│     Watches that virtual screen and broadcasts it via raw VNC (5900).  │
│                                                                        │
│  3. noVNC & websockify (novnc.sh) ◄── [ YOU ARE HERE ]                 │
│     Takes that VNC stream and turns it into a WEBSITE you can open     │
│     in any browser at http://localhost:6080/vnc.html                   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## What Problem Does `novnc.sh` Solve?

### The Problem

`x11vnc` produces a **raw TCP VNC stream** (RFB protocol on port `5900`).

However:

- Web browsers (like Chrome, Safari, Edge, or Firefox) **cannot open raw TCP sockets**.
- They only understand HTTP and **WebSockets**.
- Without a dedicated VNC client installed on your computer (like TigerVNC viewer), you wouldn't be able to see or interact with the virtual screen.

### The Solution

`novnc.sh` launches **`websockify`** and **noVNC**, which does two things:

1. **Serves a web page**: Provides a lightweight HTML5 + JavaScript client from `/usr/share/novnc/vnc.html`.
2. **Acts as a translator (bridge)**: When you click or type on the web page, it sends WebSockets to port `6080`. `websockify` translates those WebSocket packets into raw TCP packets and forwards them to `x11vnc` on port `5900`.

Now you can view and control the remote desktop directly in a normal browser tab!

---

## Visual Communication Flow

```text
 [ Your Laptop / Host Browser ]
   (http://localhost:6080/vnc.html)
                 │
                 │ 1. Connects via WebSockets (Port 6080)
                 ▼
 ┌────────────────────────────────────────┐
 │ websockify (novnc.sh)                  │
 │ Translates WebSockets ◄──► Raw TCP     │
 └────────────────────────────────────────┘
                 │
                 │ 2. Talks raw VNC/RFB (Port 5900)
                 ▼
 ┌────────────────────────────────────────┐
 │ x11vnc (x11vnc.sh)                     │
 │ Reads pixels / sends clicks            │
 └────────────────────────────────────────┘
                 │
                 │ 3. Attaches to display :99
                 ▼
 ┌────────────────────────────────────────┐
 │ Xvfb (xvfb.sh)                         │
 │ Virtual screen running Playwright/App  │
 └────────────────────────────────────────┘
```

---

## Configuration (`env.sh`)

All settings are controlled in [`env.sh`](env.sh):

| Variable          | Default Value      | What It Does                                                       |
| :---------------- | :----------------- | :----------------------------------------------------------------- |
| `NOVNC_PORT`      | `6080`             | The port inside the container where `websockify` listens           |
| `HOST_NOVNC_PORT` | `6080`             | The mapped port on your host laptop                                |
| `NOVNC_WEB`       | `/usr/share/novnc` | The directory containing the static HTML/JS web files (`vnc.html`) |
| `VNC_PORT`        | `5900`             | The target `x11vnc` port that `websockify` forwards traffic to     |

---

## Anatomy of the Command

Inside `novnc.sh`, the command executed is:

```bash
websockify --web "${NOVNC_WEB}" "${NOVNC_PORT}" "localhost:${VNC_PORT}" &
```

- `--web /usr/share/novnc`: Tells `websockify` to act as a mini web server and serve the noVNC web assets.
- `6080`: The public HTTP/WebSocket port.
- `localhost:5900`: The destination VNC server to connect to.

---

## How to Use `novnc.sh`

### 1. Command Line Interface (CLI)

```bash
# Start noVNC (automatically starts x11vnc and Xvfb if they aren't running!)
./scripts/display/novnc.sh start

# Check status
./scripts/display/novnc.sh status

# Stop noVNC
./scripts/display/novnc.sh stop

# Restart
./scripts/display/novnc.sh restart
```

### 2. Sourced as a Module

`novnc.sh` uses the `novnc::` namespace so [`display-stack.sh`](display-stack.sh) can source it cleanly:

```bash
# shellcheck source=/dev/null
source "./scripts/display/novnc.sh"

novnc::start
novnc::status
novnc::stop
```

---

## What Happens When You Run `novnc.sh start`?

1. **Checks if already running**: If it's already on port 6080, it says `[OK]` and shows the URL.
2. **Starts dependencies automatically**:
   - If `x11vnc` is not running, it starts it.
   - `x11vnc` checks `Xvfb` and starts that too if needed.
   - _Result_: You can run `./scripts/display/novnc.sh start` from a cold start and the entire stack boots up in order!
3. **Healthcheck verification**: Polls port `6080` using native Bash `/dev/tcp` until websockify is actively accepting connections.
4. **Prints the URL**: Gives you a clickable URL for your browser:
   - **Full UI**: `http://localhost:6080/vnc.html`
   - **Lite UI** (minimal controls): `http://localhost:6080/vnc_lite.html`

---

## Troubleshooting

### "Web page says: Server disconnected (code: 1006)"

- **Reason**: `websockify` is running on port 6080, but `x11vnc` is not answering on port 5900.
- **Fix**: Run `./scripts/display/x11vnc.sh status` and `./scripts/display/x11vnc.sh start`.

### "Port 6080 is already in use"

- **Fix**: Terminate old websockify instances with:

  ```bash
  pkill -9 -f websockify
  ```

### "Web assets not found at /usr/share/novnc"

- **Fix**: Check if noVNC is installed in the container image:

  ```bash
  ls -la /usr/share/novnc/vnc.html
  ```
