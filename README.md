# Sodly

A focus lock for video calls. Start a lock before a meeting, and Sodly keeps a reminder on screen and pulls itself back to the front whenever you drift to another app.

**Download:** [lockdown-sepia.vercel.app](https://lockdown-sepia.vercel.app)

- Lives in the menu bar, with lock lengths of 15, 25, 45 or 60 minutes
- Zoom, Meet, Teams and FaceTime are allowed. Switching to anything else puts the reminder back up and counts a "stray."
- Cmd+Q is blocked during a lock, and the Dock and menu bar are hidden
- To end a lock early, hold the give-up button for 9 seconds

It only works on your own Mac, and Force Quit always works. It can't stop app switching at the OS level, so treat it as friction, not a cage.

Built with Electron.

```bash
npm install
npm start          # run in dev
npm run build:mac  # build an unsigned .dmg into dist/
npm run build:win  # build a Windows .exe
```

The macOS build is unsigned. The first time you open it, right-click the app and choose **Open**.

## License

© 2026 Teddy Aaron. All rights reserved. Public to view only. Don't copy, reuse, deploy or redistribute any of it without written permission. See [LICENSE](LICENSE).
