using System.Text;
using Folio.Core;
using Folio.Core.Text;
using Xunit;

// Fixtures point the static AppPaths at their own temp folder, so test classes must not run in parallel.
[assembly: CollectionBehavior(DisableTestParallelization = true)]

namespace Folio.Core.Tests;

public class Fixture : IDisposable
{
    public string Root { get; } = Path.Combine(Path.GetTempPath(), "folio-tests-" + Guid.NewGuid().ToString("N")[..8]);
    public Fixture() { AppPaths.Init(Root); TextEncodings.EnsureRegistered(); }
    public void Dispose() { try { Directory.Delete(Root, true); } catch { } }
}

public class EncodingTests : IClassFixture<Fixture>
{
    const string Ru = "Съешь же ещё этих мягких французских булок, да выпей чаю. Привет! Это обычный текст заметки, " +
                      "в котором есть несколько строк и немного пунктуации — чтобы проверить определение кодировки.";
    const string RuShort = "Привет, мир";
    const string Uk = "Тарас Шевченко — український поет. Їжак і ґанок, пісня про Київ і Україну.";
    const string Cn = "今天我们一起学习中文。这个编辑器可以正确地打开文件，并且自动识别编码。中华人民共和国的首都是北京。";
    const string Tw = "今天我們一起學習中文。這個編輯器可以正確地打開檔案，並且自動識別編碼。臺灣的首都是臺北。";
    const string Jp = "今日は良い天気ですね。このエディタはファイルを正しく開いて、文字コードを自動的に判別します。";
    const string Kr = "안녕하세요. 이 편집기는 파일을 올바르게 열고 인코딩을 자동으로 감지합니다. 한국어 텍스트입니다.";
    const string Fr = "Le cœur a ses raisons que la raison ne connaît point. Été, déjà, garçon, où est la fenêtre?";
    const string De = "Größere Übungen für Straßenbahnfahrer: München, Köln und Düsseldorf sind schön.";
    const string Pl = "Zażółć gęślą jaźń. Łódź i Kraków są pięknymi miastami, a źródło jest czyste.";

    static byte[] Enc(string s, int cp) => Encoding.GetEncoding(cp).GetBytes(s);

    [Theory]
    [InlineData(1251, "windows-1251")]
    [InlineData(866, "cp866")]
    [InlineData(20866, "koi8-r")]
    [InlineData(28595, "iso-8859-5")]
    public void DetectsRussian(int cp, string expected)
    {
        var g = EncodingDetector.Detect(Enc(Ru, cp));
        Assert.Equal(expected, g.Encoding);
        Assert.True(g.Confidence >= 0.5, $"confidence {g.Confidence}");
        var t = TextFile.Decode(Enc(Ru, cp));
        Assert.Equal(Encoding.GetEncoding(cp).GetString(Enc(Ru, cp)), t.Text);
    }

    [Theory]
    [InlineData(1251, "windows-1251")]
    [InlineData(20866, "koi8-r")]
    public void DetectsShortRussian(int cp, string expected) => Assert.Equal(expected, EncodingDetector.Detect(Enc(RuShort, cp)).Encoding);

    [Fact] public void DetectsUkrainian1251() => Assert.Equal("windows-1251", EncodingDetector.Detect(Enc(Uk, 1251)).Encoding);
    [Fact] public void DetectsGb18030() => Assert.Equal("gb18030", EncodingDetector.Detect(Enc(Cn, 54936)).Encoding);
    [Fact] public void DetectsBig5() => Assert.Equal("big5", EncodingDetector.Detect(Enc(Tw, 950)).Encoding);
    [Fact] public void DetectsShiftJis() => Assert.Equal("shift_jis", EncodingDetector.Detect(Enc(Jp, 932)).Encoding);
    [Fact] public void DetectsEucKr() => Assert.Equal("euc-kr", EncodingDetector.Detect(Enc(Kr, 51949)).Encoding);
    [Fact] public void DetectsFrench1252() => Assert.Equal("windows-1252", EncodingDetector.Detect(Enc(Fr, 1252)).Encoding);
    [Fact] public void DetectsGerman1252() => Assert.Equal("windows-1252", EncodingDetector.Detect(Enc(De, 1252)).Encoding);
    [Fact] public void DetectsPolish1250() => Assert.Equal("windows-1250", EncodingDetector.Detect(Enc(Pl, 1250)).Encoding);

    [Fact]
    public void DetectsUtf8WithAndWithoutBom()
    {
        var plain = Encoding.UTF8.GetBytes(Ru + Cn);
        var g = EncodingDetector.Detect(plain);
        Assert.Equal("utf-8", g.Encoding); Assert.False(g.Bom);
        var withBom = new byte[] { 0xEF, 0xBB, 0xBF }.Concat(plain).ToArray();
        var g2 = EncodingDetector.Detect(withBom);
        Assert.Equal("utf-8", g2.Encoding); Assert.True(g2.Bom);
        Assert.Equal(Ru + Cn, TextFile.Decode(withBom).Text);
    }

    [Fact]
    public void DetectsUtf16WithoutBom()
    {
        Assert.Equal("utf-16le", EncodingDetector.Detect(Encoding.Unicode.GetBytes("Hello, world! Plain text here.")).Encoding);
        Assert.Equal("utf-16be", EncodingDetector.Detect(Encoding.BigEndianUnicode.GetBytes("Hello, world! Plain text here.")).Encoding);
    }

    [Fact]
    public void AsciiIsUtf8() => Assert.Equal("utf-8", EncodingDetector.Detect(Encoding.ASCII.GetBytes("just ascii text\r\n")).Encoding);

    [Fact]
    public void Eol()
    {
        var (t, eol, mixed) = TextFile.NormalizeEol("a\r\nb\r\nc");
        Assert.Equal("a\nb\nc", t); Assert.Equal("crlf", eol); Assert.False(mixed);
        (t, eol, mixed) = TextFile.NormalizeEol("a\nb\r\nc\nd");
        Assert.Equal("a\nb\nc\nd", t); Assert.Equal("lf", eol); Assert.True(mixed);
        (t, eol, _) = TextFile.NormalizeEol("a\rb\rc");
        Assert.Equal("a\nb\nc", t); Assert.Equal("cr", eol);
    }

    [Fact]
    public void CheckEncodable()
    {
        var r = TextFile.CheckEncodable("Привет 😀 мир\nи 中文", "windows-1251");
        Assert.Equal(3, r.Count);
        Assert.Equal(new[] { 1, 8 }, r.Positions[0]);
        Assert.Equal(new[] { 2, 3 }, r.Positions[1]);
        Assert.Equal(0, TextFile.CheckEncodable("Привет мир", "windows-1251").Count);
        Assert.Equal(0, TextFile.CheckEncodable("anything 😀", "utf-8").Count);
    }

    [Fact]
    public void Previews()
    {
        var data = Enc("First line\n" + Ru, 1251);
        var p = TextFile.Previews(data, new[] { "windows-1251", "cp866", "utf-8" });
        Assert.StartsWith("Съешь", p[0].Preview);
        Assert.Equal(3, p.Count);
    }
}

public class FileTests : IClassFixture<Fixture>
{
    readonly Fixture _f;
    public FileTests(Fixture f) => _f = f;

    string NewPath(string name) { var d = Path.Combine(_f.Root, "files"); Directory.CreateDirectory(d); return Path.Combine(d, Guid.NewGuid().ToString("N")[..6] + name); }

    [Theory]
    [InlineData("utf-8", false, "crlf")]
    [InlineData("utf-8", true, "lf")]
    [InlineData("windows-1251", false, "crlf")]
    [InlineData("cp866", false, "lf")]
    [InlineData("koi8-r", false, "cr")]
    [InlineData("utf-16le", true, "crlf")]
    [InlineData("utf-16be", true, "lf")]
    public void SaveRoundTrip(string enc, bool bom, string eol)
    {
        var p = NewPath(".txt");
        var text = enc is "cp866" or "koi8-r" ? "Строка один\nLine two\n\nтри - \"кавычки\"" : "Строка один\nLine two\n\nтри — «кавычки»";
        var r = TextFile.Save(p, text, enc, bom, eol);
        Assert.True(r.Ok, r.Message);
        var bytes = File.ReadAllBytes(p);
        var eolStr = TextFile.EolString(eol);
        var back = TextFile.Load(p, enc);
        Assert.Equal(text, back.Text);
        Assert.Equal(eol, back.Eol);
        Assert.Equal(bom, back.Bom);
        var raw = TextEncodings.Get(enc).GetString(bytes, TextEncodings.Preamble(enc).Length * (bom ? 1 : 0), bytes.Length - TextEncodings.Preamble(enc).Length * (bom ? 1 : 0));
        Assert.Equal(text.Replace("\n", eolStr), raw);
        // detection without hints must agree for the legacy code pages used in the tests
        if (!enc.StartsWith("utf-16")) Assert.Equal(enc, TextFile.Load(p).Encoding);
    }

    [Fact]
    public void SaveReportsReplacedChars()
    {
        var p = NewPath(".txt");
        var r = TextFile.Save(p, "Привет 😀 и 中", "windows-1251", false, "crlf");
        Assert.True(r.Ok);
        Assert.Equal(2, r.Replaced);
        Assert.Equal("Привет ? и ?", TextFile.Load(p, "windows-1251").Text);
    }

    [Fact]
    public void VersionsAreKept()
    {
        var p = NewPath(".md");
        TextFile.Save(p, "v1", "utf-8", false, "lf");
        Thread.Sleep(5);
        TextFile.Save(p, "v2", "utf-8", false, "lf");
        Thread.Sleep(5);
        TextFile.Save(p, "v3", "utf-8", false, "lf");
        TextFile.Save(p, "v3", "utf-8", false, "lf"); // same content → no new version
        var list = FileVersions.List(p);
        Assert.Equal(2, list.Count);
        Assert.Equal("v2", Encoding.UTF8.GetString(FileVersions.Read(p, list[0].Id)));
        Assert.Equal("v1", Encoding.UTF8.GetString(FileVersions.Read(p, list[1].Id)));
    }

    [Fact]
    public void ReadOnlyFileIsNotOverwritten()
    {
        var p = NewPath(".txt");
        File.WriteAllText(p, "old");
        File.SetAttributes(p, FileAttributes.ReadOnly);
        var r = TextFile.Save(p, "new", "utf-8", false, "lf");
        Assert.False(r.Ok);
        Assert.Equal("readonly", r.Error);
        File.SetAttributes(p, FileAttributes.Normal);
    }

    [Fact]
    public void QuickNotesGroupByDay()
    {
        var p = NewPath("-notes.md");
        QuickNotes.Append(p, "первая", new DateTime(2026, 9, 30, 9, 5, 0));
        QuickNotes.Append(p, "вторая\nс продолжением", new DateTime(2026, 9, 30, 10, 0, 0));
        QuickNotes.Append(p, "завтра", new DateTime(2026, 10, 1, 8, 0, 0));
        var t = TextFile.Load(p).Text;
        Assert.Equal("# Быстрые заметки\n\n## 30.09.2026\n\n- 09:05 первая\n- 10:00 вторая\n  с продолжением\n\n## 01.10.2026\n\n- 08:00 завтра\n", t);
    }

    [Fact]
    public void SessionBackups()
    {
        var s = new System.Text.Json.Nodes.JsonObject
        {
            ["tabs"] = new System.Text.Json.Nodes.JsonArray(
                new System.Text.Json.Nodes.JsonObject { ["id"] = "t1", ["text"] = "несохранённый текст" },
                new System.Text.Json.Nodes.JsonObject { ["id"] = "t2", ["path"] = "C:/x.txt" }),
        };
        SessionStore.Save(s);
        var l = SessionStore.Load()!;
        Assert.Equal("несохранённый текст", l["tabs"]![0]!["text"]!.GetValue<string>());
        Assert.Null(l["tabs"]![1]!["text"]);
    }
}

public class MiscTests
{
    [Theory]
    [InlineData("1.0.1", "1.0.0", 1)]
    [InlineData("v1.2.0", "1.10.0", -1)]
    [InlineData("1.0.0", "1.0.0-beta.2", 1)]
    [InlineData("1.0.0-beta.10", "1.0.0-beta.2", 1)]
    [InlineData("1.0.0-alpha", "1.0.0-beta", -1)]
    [InlineData("2.0.0", "2.0.0", 0)]
    public void SemVer(string a, string b, int sign) => Assert.Equal(sign, Math.Sign(UpdateChecker.Compare(a, b)));

    [Fact]
    public void ParseSums()
    {
        var s = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  Folio.exe\n" +
                "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff *other.zip\n";
        Assert.Equal("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", UpdateChecker.ParseSums(s, "Folio.exe"));
        Assert.Null(UpdateChecker.ParseSums(s, "missing.exe"));
    }

    [Fact]
    public void AiEndpoint()
    {
        Assert.Equal("https://api.openai.com/v1/chat/completions", AiClient.Endpoint("https://api.openai.com/v1/", "chat/completions"));
        Assert.Equal("http://localhost:11434/v1/models", AiClient.Endpoint("http://localhost:11434/v1/chat/completions", "models"));
        var e = AiClient.MapError(401, "{\"error\":{\"message\":\"Invalid API key\"}}");
        Assert.Equal("auth", e.Code);
        Assert.Equal("Invalid API key", e.Message);
        var m = AiClient.MapError(400, "{\"error\":{\"message\":\"A supported model is required.\"}}", "deepseek-v4-flash-free");
        Assert.Equal("model", m.Code);
    }

    // 1.0.1: "Index was out of range" — a stream chunk with "choices": [] (usage / keep-alive) was indexed with [0]
    [Fact]
    public void AiStreamChunks()
    {
        var all = new StringBuilder();
        var thoughts = new StringBuilder();
        Assert.False(AiClient.Dispatch("{\"choices\":[{\"delta\":{\"reasoning_content\":\"hmm \"}}]}", all, null, t => thoughts.Append(t)));
        Assert.False(AiClient.Dispatch("{\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}", all, null));
        Assert.False(AiClient.Dispatch("{\"choices\":[{\"delta\":{\"content\":[{\"type\":\"text\",\"text\":\"lo\"}]}}]}", all, null));
        Assert.False(AiClient.Dispatch("{\"choices\":[],\"usage\":{\"total_tokens\":5}}", all, null));
        Assert.False(AiClient.Dispatch("{\"id\":\"x\"}", all, null));
        Assert.False(AiClient.Dispatch("[1,2]", all, null));
        Assert.True(AiClient.Dispatch("[DONE]", all, null));
        Assert.Equal("Hello", all.ToString());
        Assert.Equal("hmm ", thoughts.ToString());
        Assert.Throws<AiException>(() => AiClient.Dispatch("{\"error\":{\"message\":\"bad\"}}", all, null));
        Assert.Equal("ok", AiClient.ParseFull("{\"choices\":[{\"message\":{\"content\":\"ok\",\"reasoning\":\"r\"}}]}"));
        Assert.Throws<AiException>(() => AiClient.ParseFull("{\"choices\":[]}"));
        Assert.Equal("ab", AiClient.ParseSseText("data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\r\n\r\ndata: {\"choices\":[]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"b\"}}]}\n\ndata: [DONE]\n", null, null));
    }
}

public class JsonStoreTests
{
    // 1.0.0 lost its app.init reply when a value had been added with the generic JsonArray.Add<T>
    // (the options had no TypeInfoResolver): the window stayed white. The shared options must write such trees.
    [Fact]
    public void WritesValuesAddedThroughGenericAdd()
    {
        var a = new System.Text.Json.Nodes.JsonArray();
        a.Add("Win+Alt+F");
        var o = new System.Text.Json.Nodes.JsonObject { ["hotkeyFailed"] = a, ["list"] = new System.Text.Json.Nodes.JsonArray { "x", 2 } };
        var json = o.ToJsonString(JsonStore.Options);
        Assert.Contains("Win+Alt+F", json);
        Assert.Contains("\"x\"", json);
    }
}
