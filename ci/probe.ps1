$ErrorActionPreference = 'Continue'
$o = [System.Collections.Generic.List[string]]::new()
$o.Add("OS: " + [Environment]::OSVersion.VersionString + " | " + (Get-CimInstance Win32_OperatingSystem).Caption)
$o.Add("PS: " + $PSVersionTable.PSVersion + " | Interactive: " + [Environment]::UserInteractive + " | Session: " + (Get-Process -Id $PID).SessionId)
$o.Add("Culture: " + (Get-Culture).Name + " | UI: " + (Get-UICulture).Name)
$o.Add("dotnet SDKs: " + ((dotnet --list-sdks) -join '; '))
foreach ($k in 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}','HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') {
  if (Test-Path $k) { $o.Add("WebView2 " + $k + ": " + (Get-ItemProperty $k).pv) } else { $o.Add("WebView2 " + $k + ": none") }
}
$edge = Get-Item 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -ErrorAction SilentlyContinue
$o.Add("Edge: " + $(if ($edge) { $edge.VersionInfo.ProductVersion } else { 'none' }))
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
[ComImport, Guid("8E018A9D-2415-4677-BF08-794EA61F94BB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISpellCheckerFactory {
  IEnumString SupportedLanguages { get; }
  [return: MarshalAs(UnmanagedType.Bool)] bool IsSupported([MarshalAs(UnmanagedType.LPWStr)] string languageTag);
  ISpellChecker CreateSpellChecker([MarshalAs(UnmanagedType.LPWStr)] string languageTag);
}
[ComImport, Guid("B6FD0B71-E2BC-4653-8D05-F197E412770B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISpellChecker {
  string LanguageTag { [return: MarshalAs(UnmanagedType.LPWStr)] get; }
  IEnumSpellingError Check([MarshalAs(UnmanagedType.LPWStr)] string text);
  IEnumString Suggest([MarshalAs(UnmanagedType.LPWStr)] string word);
  void Add([MarshalAs(UnmanagedType.LPWStr)] string word);
  void Ignore([MarshalAs(UnmanagedType.LPWStr)] string word);
  void AutoCorrect([MarshalAs(UnmanagedType.LPWStr)] string from, [MarshalAs(UnmanagedType.LPWStr)] string to);
  byte GetOptionValue([MarshalAs(UnmanagedType.LPWStr)] string optionId);
  IEnumString OptionIds { get; }
  string Id { [return: MarshalAs(UnmanagedType.LPWStr)] get; }
  string LocalizedName { [return: MarshalAs(UnmanagedType.LPWStr)] get; }
  uint add_SpellCheckerChanged(IntPtr handler);
  void remove_SpellCheckerChanged(uint cookie);
  IntPtr GetOptionDescription([MarshalAs(UnmanagedType.LPWStr)] string optionId);
  IEnumSpellingError ComprehensiveCheck([MarshalAs(UnmanagedType.LPWStr)] string text);
}
[ComImport, Guid("803E3BD4-2828-4410-8290-418D1D73C762"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IEnumSpellingError { [PreserveSig] int Next(out ISpellingError value); }
[ComImport, Guid("B7C82D61-FBE8-4B47-9B27-6C0D2E0DE0A3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISpellingError {
  uint StartIndex { get; }
  uint Length { get; }
  int CorrectiveAction { get; }
  string Replacement { [return: MarshalAs(UnmanagedType.LPWStr)] get; }
}
[ComImport, Guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC")] public class SpellCheckerFactoryCo { }
public static class SpellProbe {
  static List<string> Drain(IEnumString e) { var l = new List<string>(); var a = new string[1]; while (e != null && e.Next(1, a, IntPtr.Zero) == 0) l.Add(a[0]); return l; }
  public static string Run() {
    var f = (ISpellCheckerFactory)new SpellCheckerFactoryCo();
    var r = "langs=" + string.Join(",", Drain(f.SupportedLanguages));
    r += " ru=" + f.IsSupported("ru-RU") + " en=" + f.IsSupported("en-US");
    var c = f.CreateSpellChecker("en-US");
    var en = c.ComprehensiveCheck("Helo wrld, this is is a test");
    ISpellingError err;
    while (en.Next(out err) == 0) {
      var w = "Helo wrld, this is is a test".Substring((int)err.StartIndex, (int)err.Length);
      r += " | " + w + "@" + err.StartIndex + " act=" + err.CorrectiveAction + " repl=" + err.Replacement + " sugg=" + string.Join("/", Drain(c.Suggest(w)));
    }
    r += " | tag=" + c.LanguageTag + " name=" + c.LocalizedName;
    return r;
  }
}
"@
try { $o.Add("Spell: " + [SpellProbe]::Run()) } catch { $o.Add("Spell ERROR: " + $_) }
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
try {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $o.Add("Screen: " + $b.Width + "x" + $b.Height + " dpi-scale? " + [System.Windows.Forms.SystemInformation]::VirtualScreen)
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); $bmp.Save("$PWD\probe-screen.png"); $o.Add("Screen capture OK")
} catch { $o.Add("Screen capture ERROR: " + $_) }
$o.Add("Fonts: " + (([System.Drawing.Text.InstalledFontCollection]::new().Families | ForEach-Object Name | Where-Object { $_ -match 'Segoe|Cascadia|Consolas|Inter|YaHei|SimSun' }) -join ', '))
$o | Out-File probe.txt -Encoding utf8
Get-Content probe.txt
