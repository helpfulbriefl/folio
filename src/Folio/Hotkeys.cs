using Folio.Core;

namespace Folio;

/// <summary>System-wide shortcuts (RegisterHotKey): quick note and "show Folio".</summary>
internal sealed class Hotkeys : NativeWindow, IDisposable
{
    readonly Dictionary<int, Action> _actions = new();
    int _next = 1;

    public Hotkeys() => CreateHandle(new CreateParams { Caption = "Folio hotkeys", Parent = new IntPtr(-3) /* HWND_MESSAGE */ });

    public void Clear()
    {
        foreach (var id in _actions.Keys) Native.UnregisterHotKey(Handle, id);
        _actions.Clear();
    }

    /// <summary>Registers "Ctrl+Alt+N"-style shortcuts. Returns the ones Windows refused (taken by another app) or could not parse.</summary>
    public List<string> Register(IEnumerable<(string keys, Action action)> list)
    {
        Clear();
        var failed = new List<string>();
        foreach (var (keys, action) in list)
        {
            if (string.IsNullOrWhiteSpace(keys)) continue;
            if (!TryParse(keys, out var mods, out var vk)) { failed.Add(keys); continue; }
            int id = _next++;
            if (Native.RegisterHotKey(Handle, id, mods | Native.MOD_NOREPEAT, vk)) _actions[id] = action;
            else { failed.Add(keys); Log.Warn($"Hotkey {keys} is taken by another program"); }
        }
        return failed;
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_HOTKEY && _actions.TryGetValue(m.WParam.ToInt32(), out var a))
        {
            try { a(); } catch (Exception ex) { Log.Error("hotkey", ex); }
            return;
        }
        base.WndProc(ref m);
    }

    static readonly Dictionary<string, uint> Named = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Space"] = 0x20, ["Enter"] = 0x0D, ["Tab"] = 0x09, ["Esc"] = 0x1B, ["Escape"] = 0x1B, ["Backspace"] = 0x08, ["Delete"] = 0x2E, ["Insert"] = 0x2D,
        ["Home"] = 0x24, ["End"] = 0x23, ["PageUp"] = 0x21, ["PageDown"] = 0x22, ["Up"] = 0x26, ["Down"] = 0x28, ["Left"] = 0x25, ["Right"] = 0x27,
        [","] = 0xBC, ["."] = 0xBE, ["/"] = 0xBF, ["\\"] = 0xDC, [";"] = 0xBA, ["'"] = 0xDE, ["["] = 0xDB, ["]"] = 0xDD, ["-"] = 0xBD, ["="] = 0xBB, ["`"] = 0xC0,
        ["Plus"] = 0xBB, ["Minus"] = 0xBD,
    };

    public static bool TryParse(string keys, out uint mods, out uint vk)
    {
        mods = 0; vk = 0;
        var parts = keys.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (keys.EndsWith("++", StringComparison.Ordinal)) parts = parts.Append("=").ToArray();
        foreach (var p in parts)
        {
            switch (p.ToLowerInvariant())
            {
                case "ctrl": case "control": mods |= Native.MOD_CONTROL; continue;
                case "alt": mods |= Native.MOD_ALT; continue;
                case "shift": mods |= Native.MOD_SHIFT; continue;
                case "win": case "meta": mods |= Native.MOD_WIN; continue;
            }
            if (p.Length == 1 && char.IsAsciiLetterOrDigit(p[0])) vk = char.ToUpperInvariant(p[0]);
            else if (p.Length is >= 2 and <= 3 && (p[0] == 'F' || p[0] == 'f') && int.TryParse(p[1..], out var f) && f is >= 1 and <= 24) vk = (uint)(0x70 + f - 1);
            else if (Named.TryGetValue(p, out var v)) vk = v;
            else return false;
        }
        return vk != 0 && mods != 0;
    }

    public void Dispose()
    {
        Clear();
        DestroyHandle();
    }
}
