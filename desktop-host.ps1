param(
  [ValidateSet('inspect', 'place', 'icons')][string]$Action = 'inspect',
  [long]$Handle = 0,
  [int]$Width = 0,
  [int]$Height = 0,
  [int]$X = 0,
  [int]$Y = 0,
  [ValidateSet('true', 'false')][string]$Visible = 'true'
)

$source = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class DesktopHost {
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder className, int maxCount);
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] public static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool ShowWindow(IntPtr hwnd, int command);
  public static string ClassOf(IntPtr hwnd) { var text = new StringBuilder(256); GetClassName(hwnd, text, text.Capacity); return text.ToString(); }
  public static IntPtr FindDescendant(IntPtr root, string className) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(root, (hwnd, ignored) => {
      if (ClassOf(hwnd) == className) { found = hwnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
Add-Type -TypeDefinition $source -ErrorAction Stop

$windows = [System.Collections.Generic.List[object]]::new()
$callback = [DesktopHost+EnumWindowsProc]{
  param([IntPtr]$hwnd, [IntPtr]$lParam)
  $className = [DesktopHost]::ClassOf($hwnd)
  if ($Action -eq 'inspect' -or $className -eq 'WorkerW' -or $className -eq 'Progman') {
    $defView = [DesktopHost]::FindWindowEx($hwnd, [IntPtr]::Zero, 'SHELLDLL_DefView', $null)
    $windows.Add([pscustomobject]@{ Handle = $hwnd.ToInt64(); Class = $className; HasIcons = ($defView -ne [IntPtr]::Zero) })
  }
  return $true
}
[void][DesktopHost]::EnumWindows($callback, [IntPtr]::Zero)

if ($Action -eq 'inspect') { $windows | Where-Object { $_.Class -eq 'Progman' -or $_.Class -eq 'WorkerW' } | ConvertTo-Json -Compress; exit 0 }
$target = $windows | Where-Object { $_.HasIcons } | Select-Object -First 1
if (-not $target) { throw 'Windows desktop icon host was not found.' }
if ($Action -eq 'icons') {
  $desktopView = [DesktopHost]::FindWindowEx([IntPtr]::new([long]$target.Handle), [IntPtr]::Zero, 'SHELLDLL_DefView', $null)
  if ($desktopView -eq [IntPtr]::Zero) { throw 'Windows desktop view was not found.' }
  $iconList = [DesktopHost]::FindDescendant($desktopView, 'SysListView32')
  $iconWindow = if ($iconList -ne [IntPtr]::Zero) { $iconList } else { $desktopView }
  $wasVisible = [DesktopHost]::IsWindowVisible($iconWindow)
  $show = $Visible -eq 'true'
  if ($wasVisible -ne $show) { [void][DesktopHost]::ShowWindow($iconWindow, $(if ($show) { 8 } else { 0 })) }
  [pscustomobject]@{ IconsHandled = $true; WasVisible = $wasVisible; IsVisible = [DesktopHost]::IsWindowVisible($iconWindow); TargetClass = [DesktopHost]::ClassOf($iconWindow) } | ConvertTo-Json -Compress
  exit 0
}
if ($Handle -le 0 -or $Width -le 0 -or $Height -le 0) { throw 'A valid window handle and size are required.' }
$overlay = [IntPtr]::new($Handle)
$iconHost = [IntPtr]::new([long]$target.Handle)
# Keep the Electron window top-level: reparenting a layered transparent window paints black on some desktops.
# Keep the transparent window owned by the desktop, but place it above the icon view so its controls receive clicks.
[void][DesktopHost]::SetWindowLongPtr($overlay, -8, $iconHost) # GWLP_HWNDPARENT sets the owner of a top-level window.
if ([DesktopHost]::GetWindow($overlay, 4) -ne $iconHost) { throw 'Desktop window ownership could not be verified.' } # GW_OWNER
$flags = 0x0010 -bor 0x0040 # SWP_NOACTIVATE | SWP_SHOWWINDOW
if (-not [DesktopHost]::SetWindowPos($overlay, [IntPtr]::Zero, $X, $Y, $Width, $Height, $flags)) { throw "SetWindowPos failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" } # HWND_TOP, without making it always-on-top
[pscustomobject]@{ Placed = $true; IconHost = $target.Handle; IconHostClass = $target.Class } | ConvertTo-Json -Compress
