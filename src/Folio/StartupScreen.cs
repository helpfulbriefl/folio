namespace Folio;

/// <summary>Covers the WebView until the page reports app.ready: shows that Folio is starting and, when the
/// interface does not come up, what happened and what can be done (compatibility mode, log folder, quit).
/// Without it a failed start looked like an empty white window.</summary>
internal sealed class StartupScreen : Control
{
    readonly Label _title, _text, _detail;
    readonly FlowLayoutPanel _buttons;
    readonly Color _fg;

    public StartupScreen(Color bg, bool dark)
    {
        SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = bg;
        _fg = dark ? Color.FromArgb(0xEC, 0xEA, 0xE5) : Color.FromArgb(0x2A, 0x27, 0x23);
        var muted = dark ? Color.FromArgb(0xA3, 0xA0, 0x99) : Color.FromArgb(0x6F, 0x6A, 0x62);
        _title = new Label { Text = "Folio", AutoSize = true, ForeColor = _fg, BackColor = Color.Transparent, Font = new Font("Segoe UI Semibold", 20f), UseMnemonic = false };
        _text = new Label { AutoSize = false, ForeColor = muted, BackColor = Color.Transparent, Font = new Font("Segoe UI", 10.5f), TextAlign = ContentAlignment.TopCenter, UseMnemonic = false };
        _detail = new Label { AutoSize = false, Visible = false, ForeColor = muted, BackColor = Color.Transparent, Font = new Font("Consolas", 8.5f), TextAlign = ContentAlignment.TopCenter, UseMnemonic = false };
        _buttons = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = true, FlowDirection = FlowDirection.LeftToRight, Visible = false, BackColor = Color.Transparent };
        Controls.AddRange(new Control[] { _title, _text, _detail, _buttons });
        // the page draws the title bar, so until it is there the window is moved by dragging this screen
        foreach (var c in new Control[] { this, _title, _text, _detail, _buttons })
            c.MouseDown += (s, e) => { if (e.Button == MouseButtons.Left) DragRequested?.Invoke(); };
    }

    public event Action? DragRequested;
    public bool Failed { get; private set; }

    public void SetText(string text)
    {
        _text.Text = text;
        PerformLayout();
        Invalidate(true);
    }

    public void ShowFailure(string text, string detail, IEnumerable<(string Label, Action Run)> actions)
    {
        Failed = true;
        _text.Text = text;
        _text.ForeColor = _fg;
        _detail.Text = detail;
        _detail.Visible = detail.Length > 0;
        _buttons.SuspendLayout();
        foreach (var c in _buttons.Controls.Cast<Control>().ToList()) { _buttons.Controls.Remove(c); c.Dispose(); }
        foreach (var (label, run) in actions)
        {
            var b = new Button { Text = label, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, FlatStyle = FlatStyle.System, Margin = new Padding(6), Padding = new Padding(10, 3, 10, 3), UseVisualStyleBackColor = true, UseMnemonic = false };
            b.Click += (s, e) => { try { run(); } catch (Exception ex) { Folio.Core.Log.Warn("startup action: " + ex.Message); } };
            _buttons.Controls.Add(b);
        }
        _buttons.Visible = _buttons.Controls.Count > 0;
        _buttons.ResumeLayout();
        PerformLayout();
        Invalidate(true);
        if (_buttons.Controls.Count > 0) _buttons.Controls[0].Focus();
    }

    protected override void OnLayout(LayoutEventArgs e)
    {
        base.OnLayout(e);
        if (_text == null || ClientSize.Width < 60) return;
        int gap = LogicalToDeviceUnits(10);
        int w = Math.Max(40, Math.Min(ClientSize.Width - LogicalToDeviceUnits(48), LogicalToDeviceUnits(640)));
        const TextFormatFlags flags = TextFormatFlags.WordBreak | TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPrefix;
        int th = _text.Text.Length == 0 ? 0 : TextRenderer.MeasureText(_text.Text, _text.Font, new Size(w, int.MaxValue), flags).Height + 2;
        int dh = !_detail.Visible ? 0 : TextRenderer.MeasureText(_detail.Text, _detail.Font, new Size(w, int.MaxValue), flags).Height + 2;
        var bs = _buttons.Visible ? _buttons.GetPreferredSize(new Size(w, 0)) : Size.Empty;
        if (bs.Width > w) bs.Width = w;
        var ts = _title.PreferredSize;
        int total = ts.Height + gap + th + (dh > 0 ? gap + dh : 0) + (bs.Height > 0 ? gap * 2 + bs.Height : 0);
        int y = Math.Max(gap, (ClientSize.Height - total) / 2 - LogicalToDeviceUnits(24));
        int left = (ClientSize.Width - w) / 2;
        _title.Bounds = new Rectangle((ClientSize.Width - ts.Width) / 2, y, ts.Width, ts.Height);
        y += ts.Height + gap;
        _text.Bounds = new Rectangle(left, y, w, th);
        y += th;
        if (dh > 0) { y += gap; _detail.Bounds = new Rectangle(left, y, w, dh); y += dh; }
        if (bs.Height > 0) { y += gap * 2; _buttons.Bounds = new Rectangle((ClientSize.Width - bs.Width) / 2, y, bs.Width, bs.Height); }
    }
}
