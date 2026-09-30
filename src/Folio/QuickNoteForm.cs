using System.Drawing.Drawing2D;
using Folio.Core;

namespace Folio;

/// <summary>Small native window for Ctrl+Alt+N: type a thought, press Enter — it is appended to the notes file with the time.</summary>
internal sealed class QuickNoteForm : Form
{
    readonly FolioApp _app;
    readonly TextBox _text;
    readonly Label _title, _hint, _status;
    readonly Button _save, _open, _pin, _close;
    readonly Panel _box;
    bool _dark;

    static readonly Color LBg = ColorTranslator.FromHtml("#FBFAF7"), LSurface = Color.White, LText = ColorTranslator.FromHtml("#1C1B19"),
        LMuted = ColorTranslator.FromHtml("#7A776F"), LLine = ColorTranslator.FromHtml("#E4E2DC");
    static readonly Color DBg = ColorTranslator.FromHtml("#1E1F23"), DSurface = ColorTranslator.FromHtml("#26272C"), DText = ColorTranslator.FromHtml("#ECECEE"),
        DMuted = ColorTranslator.FromHtml("#9A9AA2"), DLine = ColorTranslator.FromHtml("#36373D");
    static readonly Color Teal = ColorTranslator.FromHtml("#0E7C68"), Coral = ColorTranslator.FromHtml("#C2412D");

    public QuickNoteForm(FolioApp app)
    {
        _app = app;
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96, 96);
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = false;
        KeyPreview = true;
        Font = new Font("Segoe UI", 9.75f);
        ClientSize = new Size(560, 236);
        Padding = new Padding(18, 14, 18, 14);
        Text = "Folio";
        try { using var s = WebAssets.Resource("folio.ico"); if (s != null) Icon = new Icon(s); } catch { }

        _title = new Label { AutoSize = false, Location = new Point(18, 14), Size = new Size(300, 26), TextAlign = ContentAlignment.MiddleLeft, Font = new Font("Segoe UI Semibold", 10.5f) };
        _pin = FlatButton("\uE718", 10f); _pin.Location = new Point(560 - 18 - 64, 13); _pin.Size = new Size(30, 28);
        _close = FlatButton("\uE8BB", 9f); _close.Location = new Point(560 - 18 - 30, 13); _close.Size = new Size(30, 28);
        _pin.Click += (s, e) => { TopMost = !TopMost; UpdateColors(); };
        _close.Click += (s, e) => HideNote();

        _box = new Panel { Location = new Point(18, 48), Size = new Size(524, 124), Padding = new Padding(12, 10, 12, 10) };
        _text = new TextBox { Multiline = true, BorderStyle = BorderStyle.None, Dock = DockStyle.Fill, Font = new Font("Segoe UI", 11.25f), AcceptsReturn = false, ScrollBars = ScrollBars.None, WordWrap = true };
        _box.Controls.Add(_text);
        _box.Paint += (s, e) =>
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var pen = new Pen(_text.Focused ? (_dark ? ColorTranslator.FromHtml("#7AA2FF") : ColorTranslator.FromHtml("#2F6FEB")) : (_dark ? DLine : LLine), 1.2f);
            var r = new Rectangle(0, 0, _box.Width - 1, _box.Height - 1);
            using var path = Rounded(r, 9);
            e.Graphics.DrawPath(pen, path);
        };
        _text.GotFocus += (s, e) => _box.Invalidate();
        _text.LostFocus += (s, e) => _box.Invalidate();

        _hint = new Label { AutoSize = false, Location = new Point(18, 186), Size = new Size(300, 36), TextAlign = ContentAlignment.MiddleLeft, Font = new Font("Segoe UI", 8.5f) };
        _status = new Label { AutoSize = false, Location = new Point(18, 186), Size = new Size(300, 36), TextAlign = ContentAlignment.MiddleLeft, Font = new Font("Segoe UI Semibold", 9f), Visible = false };
        _open = FlatButton("\uE8A7", 10f); _open.Location = new Point(560 - 18 - 112 - 8 - 34, 188); _open.Size = new Size(34, 32);
        _save = new Button { Location = new Point(560 - 18 - 112, 188), Size = new Size(112, 32), FlatStyle = FlatStyle.Flat, Font = new Font("Segoe UI Semibold", 9.5f), Cursor = Cursors.Hand };
        _save.FlatAppearance.BorderSize = 0;
        _save.Click += async (s, e) => await SaveAsync();
        _open.Click += (s, e) => { HideNote(); _app.OpenInPrimary(new[] { NotesFile() }); };

        Controls.AddRange(new Control[] { _title, _pin, _close, _box, _hint, _status, _open, _save });
        foreach (var c in new Control[] { this, _title })
            c.MouseDown += (s, e) => { if (e.Button == MouseButtons.Left) { Native.ReleaseCapture(); Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)Native.HTCAPTION, IntPtr.Zero); } };
        Deactivate += (s, e) => { if (!TopMost && string.IsNullOrWhiteSpace(_text.Text)) HideNote(); };
        ApplyStrings();
    }

    static readonly string IconFont = new System.Drawing.Text.InstalledFontCollection().Families.Any(f => f.Name == "Segoe Fluent Icons") ? "Segoe Fluent Icons" : "Segoe MDL2 Assets";

    static Button FlatButton(string text, float size)
    {
        var b = new Button { Text = text, FlatStyle = FlatStyle.Flat, Font = new Font(IconFont, size), Cursor = Cursors.Hand, TabStop = false };
        b.FlatAppearance.BorderSize = 0;
        return b;
    }

    static GraphicsPath Rounded(Rectangle r, int radius)
    {
        var p = new GraphicsPath();
        int d = radius * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ClassStyle |= 0x20000; /* CS_DROPSHADOW */ return cp; }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.SetDwm(Handle, Native.DWMWA_WINDOW_CORNER_PREFERENCE, 2);
    }

    public void ApplyStrings()
    {
        _title.Text = _app.Str("qn.title", "Quick note");
        _text.PlaceholderText = _app.Str("qn.placeholder", "A thought, a link, a task…");
        _hint.Text = _app.Str("qn.hint", "Enter to save · Shift+Enter for a new line · Esc to close");
        _save.Text = _app.Str("qn.save", "Save");
        var tip = new ToolTip();
        tip.SetToolTip(_open, _app.Str("qn.open", "Open the notes file") + "\n" + NotesFile());
        tip.SetToolTip(_pin, _app.Str("qn.pin", "Keep on top"));
        tip.SetToolTip(_close, _app.Str("qn.close", "Close"));
    }

    void UpdateColors()
    {
        _dark = _app.DarkTheme;
        Color bg = _dark ? DBg : LBg, surface = _dark ? DSurface : LSurface, text = _dark ? DText : LText, muted = _dark ? DMuted : LMuted;
        BackColor = bg;
        _box.BackColor = surface; _text.BackColor = surface; _text.ForeColor = text;
        _title.ForeColor = text; _hint.ForeColor = muted;
        foreach (var b in new[] { _pin, _close, _open })
        {
            b.BackColor = bg; b.ForeColor = muted;
            b.FlatAppearance.MouseOverBackColor = _dark ? ColorTranslator.FromHtml("#2E2F35") : ColorTranslator.FromHtml("#EFEDE8");
            b.FlatAppearance.MouseDownBackColor = b.FlatAppearance.MouseOverBackColor;
        }
        _pin.ForeColor = TopMost ? (_dark ? DText : LText) : muted;
        _save.BackColor = _dark ? DText : LText;
        _save.ForeColor = _dark ? ColorTranslator.FromHtml("#16171A") : Color.White;
        _save.FlatAppearance.MouseOverBackColor = _dark ? Color.White : ColorTranslator.FromHtml("#34322E");
        Native.SetDwm(Handle, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, _dark ? 1 : 0);
        Invalidate(true);
    }

    public string NotesFile()
    {
        var f = _app.SettingString("quickNotesFile");
        if (!string.IsNullOrWhiteSpace(f)) return Environment.ExpandEnvironmentVariables(f);
        var name = _app.Str("qn.defaultFile", "Quick notes.md");
        foreach (var ch in Path.GetInvalidFileNameChars()) name = name.Replace(ch, '_');
        return Path.Combine(AppPaths.DefaultNotesDir, name);
    }

    public void ShowNote()
    {
        ApplyStrings();
        UpdateColors();
        _status.Visible = false; _hint.Visible = true;
        var scr = Screen.FromPoint(Cursor.Position).WorkingArea;
        Location = new Point(scr.Left + (scr.Width - Width) / 2, scr.Top + Math.Max(40, (scr.Height - Height) / 3));
        Show();
        Native.SetForegroundWindow(Handle);
        Activate();
        _text.Focus();
        _text.SelectionStart = _text.TextLength;
    }

    void HideNote() => Hide();

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; HideNote(); return; }
        base.OnFormClosing(e);
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (keyData == Keys.Escape) { HideNote(); return true; }
        if (keyData == Keys.Enter || keyData == (Keys.Control | Keys.Enter)) { _ = SaveAsync(); return true; }
        if (keyData == (Keys.Shift | Keys.Enter)) { _text.SelectedText = Environment.NewLine; return true; }
        if (keyData == (Keys.Control | Keys.A)) { _text.SelectAll(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    bool _saving;
    async Task SaveAsync()
    {
        var note = _text.Text;
        if (_saving || string.IsNullOrWhiteSpace(note)) return;
        _saving = true;
        var file = NotesFile();
        var title = _app.Str("qn.title", "Quick notes");
        try
        {
            await Task.Run(() =>
            {
                Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                QuickNotes.Append(file, note, DateTime.Now, title);
            });
            Log.Ok("Quick note added to " + file);
            _text.Clear();
            ShowStatus(_app.Str("qn.saved", "Added to notes"), Teal);
            await Task.Delay(650);
            if (string.IsNullOrEmpty(_text.Text)) HideNote();
        }
        catch (Exception ex)
        {
            Log.Error("Quick note failed", ex);
            ShowStatus(_app.Str("qn.error", "Could not save the note") + ": " + ex.Message, Coral);
        }
        finally { _saving = false; }
    }

    void ShowStatus(string text, Color color)
    {
        _status.Text = text;
        _status.ForeColor = color;
        _status.Visible = true;
        _hint.Visible = false;
    }
}
