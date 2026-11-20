# Changelog

## Unreleased

- The Capture shortcut field records the key combination you press while it has focus. The active shortcut is paused while you record.
- New **Global shortcut** switch in Settings. On (the default) keeps the shortcut system-wide; off limits it to the focused Annotate Console.
- Edge docking: drop the Console within 32px of a screen's left or right edge and it docks there as a full-height panel with a 6px gap. Dragging it away restores its previous height.

## 0.6.0

- Customize the global capture shortcut in Annotate Console Settings. Changes take effect without restarting and are saved across launches.
- The shortcut skips the capture countdown. Clear the setting to restore the launch default, including any `PI_ANNOTATE_HOTKEY` override.
- A failed registration leaves the previous shortcut and saved settings in place.
