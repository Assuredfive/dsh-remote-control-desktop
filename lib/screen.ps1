# dsh-remote capture + input worker (persistent)
# protocol: stdin commands, stdout FRAME:<base64> / SIZE:WxH / POS:XxY
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# DPI awareness: physical pixels (avoid 125% scaling crop)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DPIHelper {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[DPIHelper]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref uint pvParam, uint fWinIni);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  public static IntPtr HelperWindow = IntPtr.Zero;
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  // type text via SendInput Unicode (works on the lock screen where clipboard paste may not)
  public static void TypeText(string text) {
    foreach (char c in text) {
      INPUT d = new INPUT(); d.type = 1; d.u.ki.wScan = (ushort)c; d.u.ki.dwFlags = 0x0004; // KEYEVENTF_UNICODE
      SendInput(1, new INPUT[] { d }, Marshal.SizeOf(typeof(INPUT)));
      d.u.ki.dwFlags = 0x0004 | 0x0002; // + KEYUP
      SendInput(1, new INPUT[] { d }, Marshal.SizeOf(typeof(INPUT)));
    }
  }
  // type text via virtual-key events (lock screen accepts real VK events, not Unicode scan codes)
  public static void TypeTextVK(string text) {
    foreach (char c in text) {
      short s = VkKeyScan(c);
      if (s == -1) continue;
      byte vk = (byte)(s & 0xFF);
      bool shift = (s & 0x0100) != 0;
      if (shift) keybd_event(0x10, 0, 0, UIntPtr.Zero);       // Shift down
      keybd_event(vk, 0, 0, UIntPtr.Zero);                     // key down
      keybd_event(vk, 0, 2, UIntPtr.Zero);                     // key up
      if (shift) keybd_event(0x10, 0, 2, UIntPtr.Zero);        // Shift up
    }
  }
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  // wake the display: PostMessage SC_MONITORPOWER (non-blocking) + a real SendInput mouse move
  public static void WakeDisplay() {
    try {
      // ES_CONTINUOUS|ES_DISPLAY_REQUIRED: tell Windows the display is in use (wakes it)
      SetThreadExecutionState(0x80000002);
      PostMessage((IntPtr)0xFFFF, 0x0112, (IntPtr)0xF170, (IntPtr)(-1));
      // send a 1px move then move back (net zero): registers input activity (wakes the display)
      // without drifting the cursor (repeated calls previously moved it to the bottom-right)
      INPUT[] ins = new INPUT[1];
      ins[0].type = 0;  // INPUT_MOUSE
      ins[0].u.mi.dwFlags = 0x0001;  // MOUSEEVENTF_MOVE
      ins[0].u.mi.dx = 1; ins[0].u.mi.dy = 1;
      SendInput(1, ins, Marshal.SizeOf(typeof(INPUT)));
      ins[0].u.mi.dx = -1; ins[0].u.mi.dy = -1;
      SendInput(1, ins, Marshal.SizeOf(typeof(INPUT)));
    } catch (Exception) {}
  }
  // robust foreground steal: attach to the foreground thread's input queue, then activate the target window
  public static bool ForceForeground(IntPtr h) {
    uint fgPid;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
    uint myThread = GetCurrentThreadId();
    if (fgThread != myThread) { AttachThreadInput(myThread, fgThread, true); }
    bool ok = SetForegroundWindow(h);
    if (fgThread != myThread) { AttachThreadInput(myThread, fgThread, false); }
    return ok;
  }
  // find the helper window (topmost, activatable) by title; it takes foreground when the taskbar button would otherwise
  public static IntPtr FindHelper() {
    IntPtr result = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (IsWindowVisible(h)) {
        StringBuilder t = new StringBuilder(128);
        GetWindowText(h, t, 128);
        if (t.ToString() == "dsh-remote helper") { result = h; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }
  // the desktop window that actually takes focus (Progman); GetDesktopWindow() is NOT focusable the same way
  public static IntPtr FindProgman() {
    IntPtr result = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      StringBuilder cn = new StringBuilder(64);
      GetClassName(h, cn, 64);
      if (cn.ToString() == "Progman") { result = h; return false; }
      return true;
    }, IntPtr.Zero);
    return result;
  }
  // restore all minimized windows (reliable alternative to clicking taskbar buttons)
  public static int RestoreAll() {
    int n = 0;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (IsWindowVisible(h) && IsIconic(h)) { ShowWindow(h, 9); n++; }
      return true;
    }, IntPtr.Zero);
    return n;
  }
  // minimize all visible windows (toggle counterpart of RestoreAll)
  public static int MinimizeAll() {
    int n = 0;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (IsWindowVisible(h) && !IsIconic(h)) {
        string cn = GetWinClass(h);
        if (!cn.StartsWith("Shell_TrayWnd") && !cn.Equals("Progman") && !cn.Equals("WorkerW") && !cn.Equals("XTaskBarBtn")) {
          ShowWindow(h, 6); n++;
        }
      }
      return true;
    }, IntPtr.Zero);
    return n;
  }
  static string GetWinClass(IntPtr h) {
    StringBuilder cn = new StringBuilder(128);
    GetClassName(h, cn, 128);
    return cn.ToString();
  }
  // SetCursorPos fails when taskbar/button has focus (last window minimized).
  // Activate the helper window (topmost, activatable) to give the desktop input back.
  // Server waits for RDY (handshake) so retries here never pile up commands.
  public static bool MoveWithDesktop(int x, int y) {
    if (SetCursorPos(x, y)) return true;
    IntPtr target = FindHelper();
    if (target == IntPtr.Zero) { target = FindProgman(); }
    if (target == IntPtr.Zero) { target = GetDesktopWindow(); }
    for (int i = 0; i < 4; i++) {
      keybd_event(0x12, 0, 0, UIntPtr.Zero);
      keybd_event(0x12, 0, 2, UIntPtr.Zero);
      ForceForeground(target);
      System.Threading.Thread.Sleep(200);
      if (SetCursorPos(x, y)) return true;
    }
    return false;
  }
}
"@

[WinInput]::SetProcessDPIAware() | Out-Null  # physical pixels (avoid DPI scaling offset)
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
[Console]::Out.WriteLine('SIZE:' + $screen.Width + 'x' + $screen.Height)
[Console]::Out.Flush()
# display sleep stays allowed; it is woken on demand by remote input (mouse/click)

# helper window is started by the dsh plugin (node) as a separate STA process (helper.ps1)

function Capture-Jpeg([int]$w, [int]$h, [int]$quality) {
  [WinInput]::WakeDisplay()  # wake display on view too (shows lock screen or desktop instead of black)
  $bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $captured = $false
  for ($try = 0; $try -lt 5 -and -not $captured; $try++) {
    try {
      $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
      $captured = $true
    } catch {
      [WinInput]::WakeDisplay()
      Start-Sleep -Milliseconds 400
    }
  }
  $g.Dispose()
  if (-not $captured) { $bmp.Dispose(); return $null }
  if ($w -gt 0 -and ($w -ne $screen.Width -or $h -ne $screen.Height)) {
    $scaled = New-Object System.Drawing.Bitmap($w, $h)
    $sg = [System.Drawing.Graphics]::FromImage($scaled)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
    $sg.DrawImage($bmp, 0, 0, $w, $h)
    $sg.Dispose()
    $bmp.Dispose()
    $bmp = $scaled
  }
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $quality)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, $enc, $ep)
  $bytes = $ms.ToArray()
  $ms.Dispose(); $bmp.Dispose(); $ep.Dispose()
  [Convert]::ToBase64String($bytes)
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(' ')
  switch ($parts[0]) {
    'capture' {
      $w = [int]$parts[1]; $h = [int]$parts[2]; $q = [int]$parts[3]
      try {
        $b64 = Capture-Jpeg $w $h $q
        [Console]::Out.WriteLine('FRAME:' + $b64)
      } catch {
        [Console]::Out.WriteLine('ERR:' + $_.Exception.Message)
      }
      [Console]::Out.Flush()
    }
    'hold' {
      # keep system+display awake while a remote viewer is active (prevents sleep/lock)
      [WinInput]::SetThreadExecutionState(0x80000003) | Out-Null
    }
    'release' {
      # restore normal power behavior when no remote viewer
      [WinInput]::SetThreadExecutionState(0x80000000) | Out-Null
    }
    'pos' {
      $cp = [System.Windows.Forms.Cursor]::Position
      [Console]::Out.WriteLine('POS:' + $cp.X + 'x' + $cp.Y)
      [Console]::Out.Flush()
    }
    'mouse' {
      [WinInput]::WakeDisplay()  # remote mouse move wakes the display
      [WinInput]::MoveWithDesktop([int]$parts[1], [int]$parts[2]) | Out-Null
      [Console]::Out.WriteLine('RDY')
      [Console]::Out.Flush()
    }
    'click' {
      [WinInput]::WakeDisplay()  # remote click wakes the display
      switch ($parts[1]) {
        'left' { [WinInput]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); [WinInput]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero) }
        'right' { [WinInput]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero); [WinInput]::mouse_event(0x0010,0,0,0,[UIntPtr]::Zero) }
        'down' { [WinInput]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero) }
        'up' { [WinInput]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero) }
        'wheelup' { [WinInput]::mouse_event(0x0800,0,0,120,[UIntPtr]::Zero) }
        'wheeldown' { [WinInput]::mouse_event(0x0800,0,0,-120,[UIntPtr]::Zero) }
      }
    }
    'key' {
      $text = ($parts | Select-Object -Skip 1) -join ' '
      try {
        [System.Windows.Forms.Clipboard]::SetText($text)
        Start-Sleep -Milliseconds 80
        [System.Windows.Forms.SendKeys]::SendWait('^v')
      } catch {
        try { [Console]::Out.WriteLine('ERR:key:' + $_.Exception.Message); [Console]::Out.Flush() } catch {}
      }
    }
    'keytext' {
      $text = ($parts | Select-Object -Skip 1) -join ' '
      [WinInput]::TypeTextVK($text)   # VK input (recognized by the lock screen)
    }
    'ime' {
      try { [System.Windows.Forms.SendKeys]::SendWait('+{SHIFT}') } catch {
        try { [Console]::Out.WriteLine('ERR:ime:' + $_.Exception.Message); [Console]::Out.Flush() } catch {}
      }
    }
    'restoreall' {
      [WinInput]::RestoreAll() | Out-Null
    }
    'minimizeall' {
      [WinInput]::MinimizeAll() | Out-Null
    }
    'keyenter' {
      [WinInput]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero)
      [WinInput]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero)
    }
    'keyback' {
      [WinInput]::keybd_event(0x08, 0, 0, [UIntPtr]::Zero)
      [WinInput]::keybd_event(0x08, 0, 2, [UIntPtr]::Zero)
    }
    'exit' { break }
  }
}
