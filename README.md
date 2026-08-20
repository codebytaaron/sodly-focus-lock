# Lockdown

A self-imposed focus lock for video calls. You opt in before a meeting;
Lockdown puts up a persistent on-screen reminder and nudges you back when you
drift to a distracting app. It only ever controls **your own** machine, and
only for the duration **you** set — this is a focus tool in the spirit of
Freedom / Cold Turkey, not remote or parental control software.

## What it does

- Menu-bar (tray) app, no Dock icon, always available.
- "Start Focus Lock" with a duration picker (15/25/45/60 min).
- A small always-on-top overlay banner that shows lock status and a countdown.
- Best-effort detection of switching away to a non-allowlisted app (Zoom,
  Google Meet, Microsoft Teams, and FaceTime are allowlisted) — when detected,
  the overlay is brought back to front with a warning and a running "times
  you strayed" count.
- A deliberate **hold-to-unlock** control (3 continuous seconds) to end a lock
  early. There is no hidden or instant bypass, but there is always a way out.
- The lock also just ends on its own when the timer runs out.

## What it deliberately does NOT do (read this)

macOS does not let ordinary, non-entitled apps block system-level app
switching (Cmd+Tab, Dock, Mission Control) without deep Accessibility /
Screen Recording permissions and a lot of extra native engineering that's out
of scope for this MVP. So, to be precise about what Lockdown actually does:

- It **cannot** prevent you from switching apps at the OS level.
- It **can** notice that you switched (via Electron's window focus/blur
  events, plus polling the frontmost window with the `active-win` package
  every ~2 seconds) and respond by popping its reminder window back to the
  front and logging a "stray" count.
- It is a nag/accountability layer, not a lock. Think of it as a focus
  companion that makes drifting take a little more deliberate effort — not a
  hard technical barrier.
- There is no way, and will never be a way, to use this to lock a device that
  isn't your own, or to make the unlock control inescapable. That would be
  unsafe and is explicitly out of scope.

## Project layout

```
lockdown/
├── package.json          # electron-builder config lives here
├── src/
│   ├── main.js            # tray, lock state machine, focus polling
│   ├── preload.js         # contextBridge IPC surface for the overlay
│   └── overlay.html        # the always-on-top banner UI + hold-to-unlock
├── assets/
│   ├── icon.png            # 1024x1024 app icon (auto-converted by electron-builder)
│   └── trayTemplate.png    # menu bar icon
├── landing/
│   └── index.html          # static landing page, no build step, no backend
└── README.md
```

## Running it locally (dev)

```bash
npm install
npm start
```

This launches the Electron app. Look for the Lockdown icon in your macOS
menu bar (there's no Dock icon by design — it's a background utility).

## Building the macOS app (.dmg)

```bash
npm install
npm run build:mac
```

Output lands in `dist/`. This MVP ships **unsigned / ad-hoc signed** — there's
no paid Apple Developer certificate involved (`identity: null` in
`package.json`'s `build.mac` config). That means on first launch macOS
Gatekeeper will likely block it; the user needs to right-click the app →
**Open**, or allow it under **System Settings → Privacy & Security → Open
Anyway**. This is expected and normal for an unsigned MVP build, not a bug.

## Building the Windows app (.exe)

```bash
npm run build:win
```

Produces an NSIS installer in `dist/`. Like the Mac build, it is unsigned, so
Windows SmartScreen may warn on first run ("Windows protected your PC" → **More
info** → **Run anyway**).

## Landing page

`landing/index.html` is fully static (inline CSS, no build tooling, no
external requests) — open it directly in a browser, or serve the `landing/`
folder from any static host / GitHub Pages.

## Permissions note (macOS)

For the "detect switching away from your call" feature to work reliably,
macOS may ask for **Screen Recording** or **Accessibility** permission the
first time the app polls the frontmost window (this is how the underlying
`active-win` package identifies other apps' windows on macOS). If you decline,
Lockdown still runs fine — it just won't be able to tell when you've switched
away, and the overlay/timer/hold-to-unlock all continue to work normally.

## License

MIT
