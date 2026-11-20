// Runs in <head>, before the first paint. The marking overlay and highlight windows
// must be transparent from their very first frame; otherwise every display briefly
// shows the dark Console background (a full-screen flash) when Capture starts.
if (/[?&]page=(?:desktop|mark)(?:&|$)/.test(location.search)) document.documentElement.classList.add('transparent');
