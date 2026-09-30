using System.Runtime.InteropServices;

namespace Folio;

/// <summary>Win32 functions used by the window frame, tray, hotkeys and secrets.</summary>
internal static partial class Native
{
    public const int WM_NCCALCSIZE = 0x0083, WM_NCHITTEST = 0x0084, WM_NCLBUTTONDOWN = 0x00A1, WM_GETMINMAXINFO = 0x0024,
        WM_SYSCOMMAND = 0x0112, WM_HOTKEY = 0x0312, WM_QUERYENDSESSION = 0x0011, WM_ENDSESSION = 0x0016,
        WM_ACTIVATE = 0x0006, WM_SETTINGCHANGE = 0x001A, WM_DWMCOLORIZATIONCOLORCHANGED = 0x0320, WM_DPICHANGED = 0x02E0;
    public const int HTCAPTION = 2, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14;
    public const int SC_KEYMENU = 0xF100, SC_CLOSE = 0xF060, SC_MOVE = 0xF010, SC_SIZE = 0xF000, SC_MINIMIZE = 0xF020, SC_MAXIMIZE = 0xF030, SC_RESTORE = 0xF120;
    public const int SM_CXFRAME = 32, SM_CYFRAME = 33, SM_CXPADDEDBORDER = 92, SM_CXDOUBLECLK = 36, SM_CYDOUBLECLK = 37;
    public const uint MF_BYCOMMAND = 0, MF_ENABLED = 0, MF_GRAYED = 1;
    public const uint TPM_RETURNCMD = 0x0100, TPM_LEFTALIGN = 0, TPM_TOPALIGN = 0, TPM_RIGHTBUTTON = 0x0002;
    public const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_WIN = 8, MOD_NOREPEAT = 0x4000;
    public const int VK_LBUTTON = 1;
    public const int DWMWA_USE_IMMERSIVE_DARK_MODE_OLD = 19, DWMWA_USE_IMMERSIVE_DARK_MODE = 20, DWMWA_WINDOW_CORNER_PREFERENCE = 33,
        DWMWA_BORDER_COLOR = 34, DWMWA_CAPTION_COLOR = 35, DWMWA_SYSTEMBACKDROP_TYPE = 38;
    public const int SW_RESTORE = 9, SW_SHOW = 5;

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MARGINS { public int Left, Right, Top, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct NCCALCSIZE_PARAMS { public RECT rgrc0, rgrc1, rgrc2; public IntPtr lppos; }
    [StructLayout(LayoutKind.Sequential)]
    public struct MINMAXINFO { public POINT ptReserved, ptMaxSize, ptMaxPosition, ptMinTrackSize, ptMaxTrackSize; }

    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] public static extern IntPtr GetSystemMenu(IntPtr hWnd, bool revert);
    [DllImport("user32.dll")] public static extern bool EnableMenuItem(IntPtr hMenu, uint id, uint flags);
    [DllImport("user32.dll")] public static extern int TrackPopupMenuEx(IntPtr hMenu, uint flags, int x, int y, IntPtr hWnd, IntPtr tpm);
    [DllImport("user32.dll")] public static extern int GetSystemMetricsForDpi(int index, uint dpi);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] public static extern uint GetACP();
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool ShutdownBlockReasonCreate(IntPtr hWnd, string reason);
    [DllImport("user32.dll")] public static extern bool ShutdownBlockReasonDestroy(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    public const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOZORDER = 4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20;

    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attr, ref int value, int size);
    [DllImport("dwmapi.dll")] public static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS m);

    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint pid);

    // input injection (used only by the self-test to check window dragging)
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mi; }  // 40 bytes on x64 (mouse is the largest union member)
    public const uint INPUT_MOUSE = 0, MOUSEEVENTF_LEFTDOWN = 2, MOUSEEVENTF_LEFTUP = 4;
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);

    public static void SetDwm(IntPtr hwnd, int attr, int value)
    {
        try { DwmSetWindowAttribute(hwnd, attr, ref value, sizeof(int)); } catch { }
    }

    public static bool LeftButtonDown() => (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;

    public static int OsBuild => Environment.OSVersion.Version.Build;
}

/// <summary>DPAPI (current user) without extra packages.</summary>
internal static class Dpapi
{
    [StructLayout(LayoutKind.Sequential)]
    struct BLOB { public int cbData; public IntPtr pbData; }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CryptProtectData(ref BLOB data, string? desc, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out BLOB result);
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CryptUnprotectData(ref BLOB data, IntPtr desc, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out BLOB result);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);

    const int CRYPTPROTECT_UI_FORBIDDEN = 1;

    public static byte[] Protect(byte[] plain) => Run(plain, true);
    public static byte[] Unprotect(byte[] cipher) => Run(cipher, false);

    static byte[] Run(byte[] input, bool protect)
    {
        var h = GCHandle.Alloc(input, GCHandleType.Pinned);
        try
        {
            var inBlob = new BLOB { cbData = input.Length, pbData = h.AddrOfPinnedObject() };
            BLOB outBlob;
            bool ok = protect
                ? CryptProtectData(ref inBlob, "Folio", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, out outBlob)
                : CryptUnprotectData(ref inBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, out outBlob);
            if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                var r = new byte[outBlob.cbData];
                Marshal.Copy(outBlob.pbData, r, 0, r.Length);
                return r;
            }
            finally { LocalFree(outBlob.pbData); }
        }
        finally { h.Free(); }
    }
}
