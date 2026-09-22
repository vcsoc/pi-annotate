# Read visible top-level windows in front-to-back order, in physical pixels.
# Invoked as a packaged command; no profile or persistent execution-policy change.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AnnotateWindows {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] static extern int GetFrame(IntPtr h, int attr, out Rect r, int size);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] static extern int GetCloaked(IntPtr h, int attr, out int value, int size);
  public class Window { public string id, title; public uint pid; public int x,y,width,height,order; }
  public static List<Window> Read() {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var result = new List<Window>();
    EnumWindows((h,p) => {
      int cloaked;
      if (!IsWindowVisible(h) || IsIconic(h) || (GetCloaked(h,14,out cloaked,4)==0 && cloaked!=0)) return true;
      var title = new StringBuilder(1024); GetWindowText(h,title,title.Capacity);
      if (title.Length==0) return true;
      Rect r; if (GetFrame(h,9,out r,16)!=0 && !GetWindowRect(h,out r)) return true;
      uint pid; GetWindowThreadProcessId(h,out pid);
      result.Add(new Window { id=h.ToInt64().ToString(), title=title.ToString(), pid=pid, x=r.Left, y=r.Top, width=r.Right-r.Left, height=r.Bottom-r.Top, order=result.Count });
      return true;
    },IntPtr.Zero);
    return result;
  }
}
'@
ConvertTo-Json -InputObject @([AnnotateWindows]::Read()) -Compress
