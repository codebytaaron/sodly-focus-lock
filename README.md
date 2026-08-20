# Sodly

A self-imposed focus lock for video calls. You opt in before a meeting;
Sodly puts up a persistent on-screen reminder, aggressively re-focuses
itself, and blocks casual escape/quit while you drift to a distracting app.
It only ever controls **your own** machine, and only for the duration **you**
set — this is a focus tool in the spirit of Freedom / Cold Turkey, not remote
or parental control software.

## What it does

- Menu-bar (tray) app, no Dock icon, always available.
- "Start Focus Lock" with a duration picker (15/25/45/60 min).
- A small always-on-top overlay banner that shows lock status and a countdown.
- Best-effort detection of switching away to a non-allowlisted app (Zoom,
  Google Meet, Microsoft Teams, and FaceTime are allowlisted) — when detected,
  the overlay re-asserts always-on-top / visible-on-all-workspaces and
  re-raises itself to the front within ~150-300ms, debounced so a burst of
  focus-loss events doesn't stack duplicate re-raises or spam timers. A
  running "times you strayed" count is shown.
- Cmd+Q is intercepted while a lock is active, so a reflexive quit doesn't
  kill the lock. "Quit Sodly" from the tray menu still works — that's a
  deliberate action, not a reflex.
- Dock and menu bar are hidden kiosk-style while a lock is active.
- A deliberate **hold-to-give-up** control (9 continuous seconds) to end a
  lock early. It's intentionally long — this is a "give up early" control,
  not a casual unlock button. There is no hidden or instant bypass, but there
  is always a way out.
- The lock also just ends on its own when the timer runs out.

## What it deliberately does NOT do (read this)

macOS does not let ordinary, non-entitled apps block system-level app
switching (Cmd+Tab, Dock, Mission Control) without deep Accessibility /
Screen Recording permissions and a lot of extra native engineering that's out
of scope for this MVP. So, to be precise about what Sodly actually does:

- It **cannot** prevent you from switching apps at the OS level.
- It **can** notice that you switched (via Electron's window focus/blur
  events, plus polling the frontmost window with the `active-win` package
  every ~2 seconds) and respond by popping its reminder window back to the
  front and logging a "stray" count.
- It **can** swallow a reflexive Cmd+Q while locked, and it hides the Dock
  icon and app menu bar while locked, to make casual escape take real intent.
- It is a nag/accountability layer with real friction, not an unbreakable
  lock. Think of it as a focus companion that makes drifting or quitting take
  a lot more deliberate effort — not a hard technical barrier that traps you.
- **macOS's own Force Quit (Cmd+Opt+Esc), an Activity Monitor kill, or
  `killall` always work, by design.** Sodly never attempts to block, delay,
  or survive those — no signal handler, no relaunch-on-kill, no background
  watcher/helper process. That's an intentional safety valve: it is a
  self-imposed focus tool on your own machine, not something that can trap
  you with zero exit. If you force-quit it, or reboot, it leaves no
  background process running — nothing lingers.
- There is no way, and will never be a way, to use this to lock a device that
  isn't your own, or to make the unlock control truly inescapable. That would
  be unsafe and is explicitly out of scope.

## Project layout

```
lockdown/
├── package.json          # electron-builder config lives here
├── src/
│   ├── main.js             # tray, lock state machine, focus polling, quit guard
│   ├── preload.js          # contextBridge IPC surface for the overlay
│   └── overlay.html        # the always-on-top banner UI + hold-to-give-up
├── assets/
│   ├── icon.png            # 1024x1024 app icon (auto-converted by electron-builder)
│   └── trayTemplate.png    # menu bar icon
├── landing/
│   └── index.html          # static landing page, no build step, no backend
└── README.md
```

(The GitHub repo/slug stays `lockdown`; the product itself is now called
Sodly.)

## Running it locally (dev)

```bash
npm install
npm start
```

This launches the Electron app. Look for the Sodly icon in your macOS
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
Sodly still runs fine — it just won't be able to tell when you've switched
away, and the overlay/timer/hold-to-give-up all continue to work normally.

## License

MIT
