// JXA, executed by the built-in /usr/bin/osascript. No Accessibility automation.
ObjC.import('Foundation');
ObjC.import('CoreGraphics');
var raw = $.CGWindowListCopyWindowInfo(17, 0); // on-screen, excluding desktop elements
// CoreGraphics returns a CFArrayRef; bridge it to NSArray before unwrapping.
var windows = ObjC.deepUnwrap(ObjC.castRefToObject(raw));
JSON.stringify(windows.filter(function (w) {
  return Number(w.kCGWindowLayer) === 0 && Number(w.kCGWindowAlpha) > 0;
}).map(function (w, index) {
  var b = w.kCGWindowBounds;
  return { id: String(w.kCGWindowNumber), pid: Number(w.kCGWindowOwnerPID), title: w.kCGWindowName || w.kCGWindowOwnerName || 'Application', x: b.X, y: b.Y, width: b.Width, height: b.Height, order: index };
}));
