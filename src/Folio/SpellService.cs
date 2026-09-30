using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using Folio.Core;

namespace Folio;

#region Windows Spell Checking API (spellcheck.h)
[ComImport, Guid("8E018A9D-2415-4677-BF08-794EA61F94BB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ISpellCheckerFactory
{
    IEnumString SupportedLanguages { get; }
    [return: MarshalAs(UnmanagedType.Bool)] bool IsSupported([MarshalAs(UnmanagedType.LPWStr)] string languageTag);
    ISpellChecker CreateSpellChecker([MarshalAs(UnmanagedType.LPWStr)] string languageTag);
}

[ComImport, Guid("B6FD0B71-E2BC-4653-8D05-F197E412770B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ISpellChecker
{
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
internal interface IEnumSpellingError { [PreserveSig] int Next(out ISpellingError value); }

[ComImport, Guid("B7C82D61-FBE8-4B47-9B27-6C0D2E0DE0A3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ISpellingError
{
    uint StartIndex { get; }
    uint Length { get; }
    int CorrectiveAction { get; }
    string Replacement { [return: MarshalAs(UnmanagedType.LPWStr)] get; }
}

[ComImport, Guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC")]
internal class SpellCheckerFactoryCo { }
#endregion

/// <summary>Spell checking through the checkers installed in Windows (language packs). All COM calls run on one MTA thread.</summary>
internal sealed class SpellService : IDisposable
{
    readonly BlockingCollection<Action> _queue = new();
    readonly Thread _thread;
    ISpellCheckerFactory? _factory;
    readonly Dictionary<string, ISpellChecker?> _checkers = new(StringComparer.OrdinalIgnoreCase);
    List<string> _langs = new();
    HashSet<string> _dict = new(StringComparer.OrdinalIgnoreCase);

    public SpellService()
    {
        _thread = new Thread(Loop) { IsBackground = true, Name = "Folio spell" };
        _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();
    }

    void Loop()
    {
        try
        {
            _factory = (ISpellCheckerFactory)new SpellCheckerFactoryCo();
            _langs = Drain(_factory.SupportedLanguages);
            Log.Info("Spell checkers: " + (_langs.Count > 0 ? string.Join(", ", _langs) : "none"));
        }
        catch (Exception ex) { Log.Warn("Spell checking is not available: " + ex.Message); }
        foreach (var a in _queue.GetConsumingEnumerable())
        {
            try { a(); } catch (Exception ex) { Log.Warn("spell: " + ex.Message); }
        }
    }

    Task<T> Run<T>(Func<T> f)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Add(() => { try { tcs.SetResult(f()); } catch (Exception ex) { tcs.SetException(ex); } });
        return tcs.Task;
    }

    static List<string> Drain(IEnumString? e)
    {
        var l = new List<string>();
        if (e == null) return l;
        var a = new string[1];
        while (e.Next(1, a, IntPtr.Zero) == 0 && l.Count < 64) l.Add(a[0]);
        return l;
    }

    public Task<List<string>> LanguagesAsync() => Run(() => _langs.ToList());

    public void SetDictionary(IEnumerable<string> words)
    {
        var set = new HashSet<string>(words.Where(w => !string.IsNullOrWhiteSpace(w)).Select(w => w.Trim()), StringComparer.OrdinalIgnoreCase);
        _queue.Add(() => _dict = set);
    }

    /// <summary>Finds a checker for "ru-RU"; falls back to another region of the same language (en-GB for en-US).</summary>
    ISpellChecker? CheckerFor(string lang)
    {
        if (_factory == null || string.IsNullOrWhiteSpace(lang)) return null;
        if (_checkers.TryGetValue(lang, out var c)) return c;
        string? tag = null;
        try { if (_factory.IsSupported(lang)) tag = lang; } catch { }
        if (tag == null)
        {
            var prefix = lang.Split('-')[0] + "-";
            tag = _langs.FirstOrDefault(x => x.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) ??
                  _langs.FirstOrDefault(x => x.Equals(lang.Split('-')[0], StringComparison.OrdinalIgnoreCase));
        }
        try { c = tag != null ? _factory.CreateSpellChecker(tag) : null; }
        catch (Exception ex) { Log.Warn($"spell checker {lang}: {ex.Message}"); c = null; }
        _checkers[lang] = c;
        return c;
    }

    /// <summary>Checks single words. Returns misspelled words with up to 6 suggestions; missing = no checker for the language.</summary>
    public Task<(Dictionary<string, List<string>> bad, bool missing)> CheckWordsAsync(string lang, IReadOnlyList<string> words) => Run(() =>
    {
        var bad = new Dictionary<string, List<string>>();
        var c = CheckerFor(lang);
        if (c == null) return (bad, true);
        foreach (var w in words.Distinct())
        {
            if (string.IsNullOrWhiteSpace(w) || w.Length > 64 || _dict.Contains(w)) continue;
            var errors = c.Check(w);
            if (errors == null || errors.Next(out var err) != 0 || err == null) continue;
            var list = new List<string>();
            try { if (err.CorrectiveAction == 2 && !string.IsNullOrEmpty(err.Replacement)) list.Add(err.Replacement); } catch { }
            if (err.CorrectiveAction == 3) list.Add("");
            try { foreach (var s in Drain(c.Suggest(w))) { if (!list.Contains(s)) list.Add(s); if (list.Count >= 6) break; } } catch { }
            bad[w] = list;
        }
        return (bad, false);
    });

    public void Dispose() => _queue.CompleteAdding();
}
