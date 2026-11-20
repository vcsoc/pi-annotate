# Annotate Console — design concepts

Static HTML mockups exploring new layouts for the Annotate Console. Each file is self-contained (inline CSS and SVG, no fonts, images, scripts or network requests) and shows the concept at its real window size on a neutral desktop backdrop, with a caption covering the idea, the size and the trade-offs.

## How to open

- Open `index.html` in any browser for the gallery, or open a numbered file directly (for example `open designs/console-concepts/index.html` on macOS).
- PNG screenshots of every concept are in `previews/`.

## Concepts

| # | File | Size | Narrow panel |
|---|------|------|--------------|
| 01 | `01-icon-rail-dock.html` — tool rail, stacked list, accordion settings | 320 × full height, docked right | yes |
| 02 | `02-timeline-feed.html` — chronological feed, chat-style send bar, grouped-row settings | 300 × full height, docked left | yes |
| 03 | `03-filmstrip-drawer.html` — one big draft plus capacity filmstrip, tabbed settings | 340 × full height, docked right | yes |
| 04 | `04-command-pill.html` — floating pill and tray, popover settings | 600 × 56 → 600 × 440 | no |
| 05 | `05-split-pane.html` — list/detail workbench, settings modal with sidebar | 760 × 520 | no |
| 06 | `06-card-grid.html` — card board, lightbox editor, tile settings | 640 × 560 | no |
| 07 | `07-tabbed-console.html` — Annotations / Send / Settings tabs | 420 × 600 | no |
| 08 | `08-paper-inbox-light.html` — light inbox, sentence-style settings | 440 × 620 | no |
| 09 | `09-high-contrast.html` — accessible high-contrast, keyboard-first | 480 × 760 | no |
| 10 | `10-guided-stepper.html` — Capture → Mark → Review → Send wizard, settings drawer | 480 × 600 | no |

The narrow panels (01–03) show the docked state: the window snaps to the left or right screen edge with a 6px gap and the full work-area height.

## Regenerating previews

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --screenshot=previews/01-icon-rail-dock.png --window-size=1200,1060 "file://$PWD/01-icon-rail-dock.html"
```
