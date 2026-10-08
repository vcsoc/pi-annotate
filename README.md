# Pi Annotate — v0.5.0

A floating Console for collecting application screenshots, highlighted areas and notes, then sending the complete batch to your selected active Pi project/session.

**Every saved image contains the whole selected application AND your highlighted mark together—not a crop of just the marked area.** The note is kept with that image and sent as text.

## Quick start

```sh
pi install https://github.com/vcsoc/pi-annotate
```

Start Pi (or `/reload` in an existing session), then run `/annotate`. This is **one Pi extension package**: the Console, desktop capture helpers and pinned Electron dependency are included. Pi downloads the appropriate Electron runtime for each machine; there is no separate application to install manually.

Requires a graphical desktop, Node.js **22.12+**, npm, Git, and a vision-capable Pi model. See [desktop requirements](#desktop-requirements-and-verification) for capture permissions, Linux tools and unsupported compositors. Installability does not imply native capture has been verified on every OS.

If you already have a manually copied/symlinked Annotate extension, disable it or move it out of Pi’s extension discovery directory before installing this package. **Do not load both copies.** Existing local installs are not automatically removed.

## Workflow

1. Run `/annotate` to open **Annotate Console**, initially **400×600** logical desktop units. Drag its title bar to move it; drag its edges to resize. The Console’s size **and position** are saved in Electron’s user-data directory and restored after capture and on future launches. Disconnected displays or smaller work areas recover the window onscreen. On Hyprland/sway, placement uses compositor coordinates rather than Electron’s unreliable Wayland origin.
2. Click **Capture**, or press **Ctrl+Shift+A** (Linux/Windows) / **⌘+Shift+A** (macOS). **Omarchy/Hyprland/sway:** **Live marking** is the default. Choose **Preserved frame** in Settings when you need to retain an open dropdown before marking takes focus. The Console button reads **Capture (1s)** by default: after clicking, return to the app and reopen its menu before the countdown finishes. Use the top-right **⚙ Settings** toggle to set a countdown from 0–30 seconds; settings persist across launches. Retake buttons use the same delay. Clicking the Console itself can dismiss a menu, so it cannot recover that already-dismissed state without reopening it. On macOS the selector remains non-activating and screenshots are taken after marking by native window ID; other native platforms retain their existing post-selection backend. Nothing is sent automatically.
3. Mark an area in an app:
   - **Omarchy/Hyprland/sway — Live (default):** Area uses `slurp` over the live app; Freehand uses transparent selectors. No frozen backdrop appears. The **whole application** is captured after marking, once selector surfaces close. Menus dismissed by selection may disappear from the evidence.
   - **Omarchy/Hyprland/sway — Preserved frame:** a preserved desktop frame appears at the original screen coordinates. Draw an Area or Freehand mark over it. The **whole application**, including its captured dropdown, is cropped from that same frame—not recaptured after the menu closes. Keep the app completely onscreen and unobscured. Marks outside one application are refused; popup content outside the application's bounds is not included.
   - **Windows/macOS/genuine X11:** the Console hides and transparent selection surfaces cover the connected displays. Draw directly over the visible app. Native window geometry identifies the containing app, and its exact window ID selects the full-app screenshot. **No thumbnail app chooser or separate screenshot editor.**
   - **Freehand:** choose it in the Console and draw directly over the app; the same desktop selection and adjacent-note workflow is used.
   - **GNOME/KDE Wayland limitation:** direct parity is not implemented for these compositors. They restrict global window enumeration/placement; a native compositor integration is still needed. Capture reports this explicitly instead of silently opening the old alternate editor. Do not mistake this release for universal Linux desktop acceptance.
4. A small note form opens **beside the mark**, with a **larger multiline input** that fills the popup’s available height, compact spacing and a wider ✓ button. It is a separate desktop popup beside the live highlight for every implemented direct-capture route, including macOS, Windows and freehand.
5. Enter the note and click **✓** (or Ctrl/⌘+Enter). This saves one temporary entry and returns to the Console. **Nothing is sent yet.**
6. The Console always lists saved entries. Click an entry to:
   - Edit its text directly; changes are retained automatically.
   - **Retake / replace:** redo the full capture/mark/note, replacing that entry only after a successful ✓. Its identity and list position are preserved. Cancelling or failing the retake leaves the original intact.
   - **Retake as new:** redo the capture with the previous note prefilled, appending a new entry while keeping the original.
   - **Remove:** delete that unsent entry.
   - Use **Capture** for a fresh annotation with a blank note.
7. Review the persistent whole-app privacy warning in the Console footer, then click **Send**. There is no confirmation dialog. All screenshots and notes are submitted together, and the Console closes automatically after successful delivery. If Send fails, it stays open with your annotations intact for retry.

In **Preserved frame** mode on Hyprland/sway the snapshot freezes **before** the marking overlays open; in **Live** mode and on other supported native platforms it is taken after marking. ✓ paints the mark into that full snapshot and commits the entry; subsequent changes in the live app do not silently change its evidence. Retake to capture a newer state. The note popup and Console are not included in the saved screenshot.

The Console remains resizable. On Hyprland/sway it maps with fixed-size hints, is explicitly floated/positioned, then unlocks resizing; this avoids briefly inserting the returning Console into the tiled browser layout. No desktop configuration or global window rules are installed. Live Area uses native slurp; Freehand and preserved marking use desktop selectors. Only optional Preserved frame mode temporarily holds all visible displays in memory; only the selected whole-app image is retained/sent. Preserved desktop spans are bounded to 32 megapixels at logical scale 1, and backdrops retain that resolution to avoid blurry upscaling. Saved app images still use the transport downscaling limits. The note popup is normally 340×246. Mark coordinates are normalized to the full app image, independent of display offsets, Retina resolution and screenshot downscaling. Escape, display removal, timeout or capture failure removes the selection surfaces without changing existing entries.

Escape cancels the current selection/note without changing saved entries. Closing the Console asks before discarding unsent work. `/annotate stop` closes it and **discards unsent drafts**; Pi reload, session replacement and exit also close the session-scoped companion. A vision-capable Pi model is required to Send. Busy agents receive the batch in the selected Follow-up or Queued (steering) mode.

## Settings

Use the top-right **⚙** button to open Settings:

- **Capture mode:** **Live marking** (default) or **Preserved frame**, for Hyprland/sway. The preference applies to Capture, Retake and the shortcut. Other desktops keep native post-selection capture; the preserved-mode selector is disabled there without erasing its saved preference.
- **Capture countdown:** **1 second** by default, range **0–30 seconds**, for Capture and Retake buttons. The shortcut remains immediate in either mode.
- **Maximum annotations:** default **8**, range **1–12**. Capture/Add/Send enforce it; retaking an existing entry remains allowed at capacity. Lowering below your current draft count is refused without discarding anything. The separate 12-item / 24-MiB transport ceilings remain.
- **Default Send as:** Follow-up or Queued (steering). The Console's Send as selector remains a per-batch override and is not reset by routine refreshes.

**Save settings** atomically persists all choices in Electron user-data `settings.json`; **Cancel** or **Escape** leaves them unchanged. Settings cannot be saved during capture/delivery. Countdown-only settings and earlier `annotation-settings.json` delivery/limit preferences are preserved during migration. Settings also retains **Developed by Chris Visser** and the explicit-click <https://github.com/vcsoc> link.

Capture errors remain in the Console status area after it returns, so the diagnostic can be copied/reported. On Hyprland/sway, Electron display notifications are checked against actual compositor monitor geometry before cancelling a capture; ordinary work-area changes do not cancel it.

## Delivery choice and macOS fullscreen windows

Choose **Send as → Follow-up** to wait for the current task to finish, or **Queued (steering)** for the next tool boundary. When Pi is idle, either starts a turn. The batch mode is validated end-to-end and recorded in `annotations.json` and the receipt. Acknowledged retries cannot deliver twice or change the originally accepted mode. Reload older destination sessions before selecting steering; unsupported receivers are rejected instead of silently downgrading delivery.

macOS Console, selector, highlight and note windows use native panels, join fullscreen Spaces, and retain their screen-saver overlay level when focused. The selector remains non-activating. Non-GUI panel/controller regressions pass; native fullscreen-browser acceptance is still pending.

## Choosing the destination

The **Send to project / Pi session** dropdown lists running local Pi sessions using this updated extension. Reload Pi in each project once after upgrading so it appears. Closed/historical sessions and arbitrary folders are not listed: a live session must own the destination, model and delivery callback. Sessions sharing a folder remain distinct, with names/session identifiers and a short instance ID.

- `/annotate` defaults to the project/session where the command was just run.
- Running `/annotate` from another Pi while a Console is open retargets that Console and keeps its drafts. The dropdown refreshes within about a second.
- Selecting a dropdown entry changes where **the whole batch** will be saved and delivered. Image files and metadata go to that project’s `.pi/annotations/`, and the user message goes to that session—not the Console host’s agent.
- Send is bound to the selection shown in the UI. If another terminal changes it concurrently, Send refuses the stale destination and preserves drafts. Closed destinations never fall back to a different agent.
- A batch already attempted at a destination stays bound to it for retries; retry that session or discard the batch before sending a new batch elsewhere. This prevents duplicate delivery to different agents after uncertain network failures.
- The Console remains hosted by the Pi process that first opened it. Closing/reloading that host closes the Console and loses unsent drafts, even after selecting another destination. Save/send first. `/annotate stop` closes the shared Console.

Discovery uses private session records under Pi’s agent config directory (`annotate/sessions`, mode 0600), authenticated loopback bridges, and fresh liveness checks. Tokens are never given to the renderer. Session shutdown removes its registration. `PI_ANNOTATE_REGISTRY_DIR` can isolate discovery for testing; instances must share that directory to discover one another. No screenshots are captured or sent merely by registering a session.

## Install / upgrade

Install on Linux, macOS or Windows using the same command:

```sh
pi install https://github.com/vcsoc/pi-annotate
```

For a project-only installation, use `pi install -l https://github.com/vcsoc/pi-annotate`. To pin a published release, append its tag or commit to the source URL (pinned versions do not automatically advance). The v0.5.0 feature set includes both wlroots capture modes, combined settings and delivery choices; confirm it is published before updating another machine.

Update an unpinned installation:

```sh
pi update --extension https://github.com/vcsoc/pi-annotate
```

Remove it with `pi remove https://github.com/vcsoc/pi-annotate` (add `-l` for a project-only installation). Stop the Console and save/send drafts before updating or removing. Removal does not delete previously sent batches from your projects.

On first `/annotate`, missing dependencies or the Electron runtime are installed automatically using npm, then the Console opens. Installation requires network access and a writable extension directory. A valid `PI_ANNOTATE_ELECTRON` override skips installation; invalid overrides produce an error rather than being replaced.

For local development instead of a Git package install:

```sh
git clone https://github.com/vcsoc/pi-annotate.git
cd pi-annotate
npm ci
pi -e .
```

Do not copy `node_modules` between machines; install dependencies on each destination.

Postinstall downloads the pinned Electron runtime for the current OS/architecture. If scripts are disabled, run `npm run setup` afterward. Do not copy `node_modules` across operating systems. `PI_ANNOTATE_ELECTRON` may point to an existing compatible executable; the bundled version is recommended.

After an upgrade, **save/send drafts before stopping** the old companion:

```text
/annotate stop
/reload
/annotate
```

`/annotate help` summarizes the workflow. For temporary package loading, use `pi -e .` from this directory after `npm ci`. The manifest exposes only `index.ts`; companion scripts are not registered as additional Pi extensions.

## Desktop requirements and verification

| Desktop | Capture path | Requirements / acceptance |
|---|---|---|
| Omarchy / Hyprland | Live slurp Area / transparent Freehand (default), or optional preserved-frame marking; whole-app grim evidence and adjacent note | `slurp` for Live Area, `grim`, `hyprctl`. Both modes have non-GUI regression coverage; current native acceptance pending. |
| sway | Same selectable modes using sway IPC | `slurp` for Live Area, `grim`, `swaymsg`. Actual sway acceptance outstanding. |
| Ubuntu/Debian GNOME/KDE Wayland | Direct parity blocked pending native compositor integration | No silent alternate-editor fallback. Not supported by this direct-capture implementation yet. |
| Ubuntu/Debian/other genuine X11 | Desktop mark, EWMH window detection, exact-window capture, adjacent note | `wmctrl`, `xprop`, working X desktop and Electron libraries. Native acceptance outstanding; never test by forcing X11 inside Wayland. |
| macOS | Desktop mark, CoreGraphics window geometry through built-in JXA, exact-window capture, adjacent note | Allow Screen Recording / Screen & System Audio Recording for Electron/Pi Annotate, then restart. Uses `/usr/bin/osascript`; no Xcode or Accessibility automation required. Native acceptance outstanding. |
| Windows | Desktop mark, Win32/DWM geometry, physical-to-DIP conversion, exact-window capture, adjacent note | Built-in Windows PowerShell and Win32/DWM. No persistent policy changes. Secure desktop/UAC/DRM cannot be captured. Native acceptance outstanding. |

Minimized, protected or OS-restricted windows may be unavailable. Bring the app onscreen and grant the required permission. There is no fallback to an unrelated display or a different editor. A moved/closed native target is rejected so the mark is not attached to the wrong app. Pixel selection works with web and native apps; it does not inspect DOM/CSS selectors or accessibility IDs. On grim paths the screenshot is of the app's **visible window bounds**, so occluding windows can appear in it: bring the intended app to the foreground and review the full screenshot.

Window placement uses PID/address-scoped temporary Hyprland/sway dispatches. The companion does not change user window rules, font settings, monitors, PATH or desktop configuration files. Hyprland capture additionally uses the temporary shortcut described below. Native Wayland surfaces on wlroots use a companion-only scale correction for the GTK-font-DPI mismatch observed on the reported system. Mixed-DPI/rotated display acceptance remains outstanding. Other window managers ultimately control floating/always-on-top behavior.

**Hyprland:** while Annotate is running, its shortcut is a consuming compositor binding, so Firefox and other focused applications do not receive it. This requires Hyprland’s Lua binding API (0.55+) and `curl`. It bypasses ordinary app shortcut inhibitors, not the lock screen. Existing desktop bindings and another Console’s ownership are never silently replaced: conflicts are reported and Capture remains usable. A small non-GUI helper removes the binding when the Console disconnects, including Electron crashes. It restores a free binding after compositor reloads (within about two seconds); a newly conflicting user binding disables the shortcut instead. No permanent keybinding file is written.

Other platforms retain Electron’s native global-shortcut registration; OS permissions and reserved shortcuts still apply. Wayland GlobalShortcutsPortal remains enabled for other compositor routes. Universal interception across secure OS screens is not promised. The Hyprland interception path has non-GUI regression coverage, but still needs live Firefox acceptance.

To choose another shortcut before starting Pi:

```sh
export PI_ANNOTATE_HOTKEY='CommandOrControl+Alt+A'
```

```powershell
$env:PI_ANNOTATE_HOTKEY = 'CommandOrControl+Alt+A'
```

### Safety after the reported desktop disruption

At 11:37 on 2026-09-21, while running a **forced-X11/Xwayland test on the Hyprland desktop**, the Xwayland server aborted after a bus error; an Electron GPU process subsequently crashed in NVIDIA GLX teardown after its X connection failed. Other X clients lost their server connection. This is evidence of the disruption, not proof of the underlying graphics-driver defect. No driver/display configuration was changed and no claim is made that the system-level defect is fixed.

The normal Omarchy path uses **native Wayland + grim**, not X11 capture. Startup now selects the native Ozone backend explicitly and refuses a Wayland session with a missing `WAYLAND_DISPLAY` instead of falling back to Xwayland. Do not unset Wayland variables or force X11 to test this plugin on your working Wayland session. Actual X11 acceptance must happen on a genuine, disposable X11 test desktop.

## Privacy, persistence and limits

- No background recording, startup screenshot, audio or automatic Send.
- Drafts remain in companion memory until Send. **Unsent drafts are lost if the companion or session exits/crashes.** There is no draft recovery store.
- **The entire selected app is attached**, including content outside the highlighted region. Review it for secrets before Send. There is no redaction tool.
- Native window capture APIs may create local window thumbnails while locating the exact target ID. Only the selected full-app image enters the annotation. Native window titles are used as labels, never executed as commands.
- Send stores highlighted PNGs and `annotations.json` under `<project>/.pi/annotations/<batch-id>/` and sends image attachments plus notes to the selected Pi session/model provider. Add `.pi/annotations/` to `.gitignore`.
- Saved batches and Pi session attachments remain until you delete them; there is no automatic cleanup.
- Configured limit: **8 entries by default**, selectable **1–12**. Hard safety ceilings: **12 entries**, **8,000 characters per note**, **24 MiB batch**. App images are downscaled to at most 1920px on the longest side, further if needed for size limits. Replacement remains possible when the list is full.
- An authenticated loopback bridge binds only `127.0.0.1` on a random port. The per-launch token is held by the native process, not exposed to renderers or URLs. Browser origins, unexpected Host headers and invalid/oversized PNG payloads are rejected.
- Renderers are sandboxed with context isolation, no Node integration, strict CSP and a narrow preload API. Navigation/new windows are blocked.
- Concurrent saves are serialized. Cropped-mark screenshots are refused when their dimensions differ from the retained full-app frame. Cancelled retakes cannot commit stale changes. Failed sends keep the batch; unchanged-batch retries are idempotent while the bridge runs.
- This is a source-distributed Electron companion, not a signed/notarized standalone installer. No custom Pi TUI components are rendered.

## Tests

**Safe, non-GUI checks:**

```sh
npm run check
node test/pi-headless.mjs  # optional: requires pi on PATH; registration/help only
```

These cover the authenticated bridge, image delivery/persistence, full-app/mark mapping, monitor offsets, note placement, replacement/append rules and actual main-process IPC behavior using a stubbed Electron module. They also cover cropped-image rejection, duplicate Tick, cancellation during validation, failed Send retention and native-backend safety, both capture modes with Area/Freehand, combined preference persistence/legacy migration, draft-safe limits and renderer Save/Cancel, destination-bound steering/follow-up receipts and macOS panel levels. No Electron executable, GPU process or desktop capture is started by this command. Node may print an experimental-loader warning for the controller VM tests.

**Desktop tests are disabled by default.** Only opt in with work saved, on an appropriate test desktop, and with permission to manipulate its windows:

```sh
ANNOTATE_LIVE_TESTS=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test/desktop-smoke.mjs
ANNOTATE_LIVE_TESTS=1 PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node test/slurp-smoke.mjs
ANNOTATE_LIVE_TESTS=1 node test/pi-smoke.mjs
```

- Desktop smoke opens synthetic apps on the displays with isolated test preferences explicitly selecting Preserved frame on wlroots. Pointer marking uses real desktop selectors; actual compositor placement and grim screenshots are used. It verifies Console paint dimensions/edges, adjacent multiline note, full-app image size, unchanged pixels outside the mark, changed pixels inside it, edit/retake/cancel/append and explicit Send.
- Selector smoke (`slurp-smoke.mjs`, legacy filename) checks preserved-frame selector windows on all outputs and Escape cancellation. It explicitly selects Preserved frame with isolated test preferences and requires Hyprland and `wtype`.
- Pi smoke checks real extension discovery and companion startup/shutdown without a provider call.
- Tests deliver only to a test bridge and do not persist screenshots unless `ANNOTATE_TEST_ARTIFACTS` explicitly requests synthetic test artifacts.

The Console position/return regression is covered by non-GUI tests; its new pre-map sizing sequence still needs live compositor acceptance. The prior Hyprland Area workflow passed before desktop testing was paused. v0.4 adds native window adapters and direct desktop selection; those new macOS/Windows/X11/freehand routes have **not been live-tested here**. Non-GUI tests validate routing, helper invocation/JSON, coordinate mapping, exact source IDs and shared Console/save/send behavior—not OS rendering, permissions or the native helper runtimes.

### Native acceptance checklist

On the Mac/Windows machine after updating, restart the companion (send existing drafts first). Grant OS capture permission if requested. Verify Capture immediately lets you drag on the app rather than opening an app chooser. Check both capture modes on Hyprland/sway, both monitors, a negative-offset display, Retina/mixed DPI, fullscreen apps/Spaces, Escape, freehand, the adjacent multiline note, full-app screenshot with mark, retake cancellation, and Send closing the Console. Use a synthetic/non-sensitive app first. Report the Console error text if window detection or permission fails.

This release implements the requested interaction for the supported direct-capture routes; **universal OS parity is still incomplete** because GNOME/KDE integration and native-machine acceptance remain outstanding.
