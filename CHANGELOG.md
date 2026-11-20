# Changelog

## 0.8.1

- Fixed a full-screen flash on every display when Capture starts (and again after marking). The marking overlay and highlight windows briefly showed the Console's dark background before turning transparent. They are now transparent from their first frame.

## 0.8.0

- The capture shortcut and the Global switch are saved and applied as soon as you set them. A confirmation (or an error) appears directly under the field. Previously the recorded keys were only kept after **Save settings**, so leaving Settings any other way lost them.
- New **Default mark tool** setting, Freehand by default. Capture and the keyboard shortcut start with it.
- New **When a mark crosses the app edge** setting. **Trim** (default) cuts the mark to the app window where you started drawing. **Extend** widens the screenshot to include the whole app plus the overflowing part of the mark. Previously, crossing the edge cancelled the capture.
- Settings help text moved into ⓘ tooltips next to each setting. Errors from Save show beside the Save button.

## 0.7.0

- **Numbered marks:** open an annotation (double-click, or ＋ Mark) and draw more Area/Freehand marks on its screenshot. Each mark gets a number badge in the image and its own comment. Pi receives the marks as a numbered list, with coordinates for each. Send waits until every mark has a comment.
- **Freehand on the live app:** the on-screen marking overlay has an Area/Freehand switch (keys A/F where the overlay can take focus). The capture shortcut reuses the last tool.
- New default **Timeline feed** Console design: a narrow panel (320px wide, about 60% of the screen height) that lists annotations as a timeline and expands the selected one in place. On first launch it opens docked to the right edge.
- Double-click an annotation in the timeline to open it in a popup beside the panel, level with that entry. The popup has previous/next, the full screenshot, an editable note, Retake, Capture with this note, Remove and Done.
- Optional **Command pill** design (Settings → Appearance → Console design): a 600×56 floating bar with Capture, a batch meter, shortcut and Send. It opens into a tray of annotation cards and a two-column settings view.
- Edge docking now keeps the timeline at about 60% of the screen height rather than full height. The pill does not dock.
- The Capture shortcut field records the key combination you press while it has focus. The active shortcut is paused while you record.
- New **Global shortcut** switch in Settings. On (the default) keeps the shortcut system-wide; off limits it to the focused Annotate Console.
- Edge docking: drop the Console within 32px of a screen's left or right edge and it docks there as a full-height panel with a 6px gap. Dragging it away restores its previous height.

## 0.6.0

- Customize the global capture shortcut in Annotate Console Settings. Changes take effect without restarting and are saved across launches.
- The shortcut skips the capture countdown. Clear the setting to restore the launch default, including any `PI_ANNOTATE_HOTKEY` override.
- A failed registration leaves the previous shortcut and saved settings in place.
