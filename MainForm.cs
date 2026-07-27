using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TodoDailyLoop;

/// <summary>
/// 主窗口：无边框窗体 + WebView2 渲染 UI + 系统托盘 + 消息桥。
/// 消息协议（JSON）：
///   JS → C#：ready / save{data} / drag / setTopmost{value} / setClickThrough{value}
///             / setAutostart{value} / setWideMode{value} / minimize / quit
///             / enterMini{height} / exitMini / miniHeight{height}
///   C# → JS：init{data,settings} / saved{time} / settings{settings}
/// </summary>
internal sealed class MainForm : Form
{
    private const int ResizeGrip = 6;
    /// <summary>Mini 模式窗口高度下限（物理像素）。</summary>
    private const int MiniMinHeight = 120;

    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _miTopmost;
    private readonly ToolStripMenuItem _miClickThrough;
    private readonly ToolStripMenuItem _miAutostart;
    private readonly ShellSettings _settings;
    private readonly System.Windows.Forms.Timer _savePosTimer = new() { Interval = 500 };
    private readonly string _dataFile =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "todo-data.json");

    private bool _reallyExit;
    private bool _webReady;
    /// <summary>进入 Mini 模式前的窗口位置与高度（null = 当前非 Mini）。</summary>
    private Rectangle? _preMiniBounds;

    public MainForm()
    {
        _settings = ShellSettings.Load();

        // 无边框、可缩放（四周一圈 Padding 作为缩放手柄区）
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(0xE4, 0xE2, 0xDD);
        Padding = new Padding(ResizeGrip);
        MinimumSize = new Size(300, 400);
        Size = new Size(Math.Max(_settings.Width, 300), Math.Max(_settings.Height, 400));
        Location = _settings.X >= 0 && _settings.Y >= 0
            ? new Point(_settings.X, _settings.Y)
            : new Point(Screen.PrimaryScreen!.WorkingArea.Right - Width - 24,
                        Screen.PrimaryScreen.WorkingArea.Bottom - Height - 24);
        TopMost = _settings.Topmost;
        ShowInTaskbar = true;
        Text = "TODO · DAILY LOOP";

        Controls.Add(_webView);

        // 托盘
        _miTopmost = new ToolStripMenuItem("置顶") { Checked = _settings.Topmost, CheckOnClick = true };
        _miTopmost.CheckedChanged += (_, _) => SetTopmost(_miTopmost.Checked, notifyWeb: true);
        _miClickThrough = new ToolStripMenuItem("点击穿透") { Checked = _settings.ClickThrough, CheckOnClick = true };
        _miClickThrough.CheckedChanged += (_, _) => SetClickThrough(_miClickThrough.Checked, notifyWeb: true);
        _miAutostart = new ToolStripMenuItem("开机自启") { Checked = Autostart.IsEnabled(), CheckOnClick = true };
        _miAutostart.CheckedChanged += (_, _) => SetAutostart(_miAutostart.Checked, notifyWeb: true);

        var menu = new ContextMenuStrip();
        var miShow = new ToolStripMenuItem("显示 / 隐藏");
        miShow.Click += (_, _) => ToggleVisible();
        var miQuit = new ToolStripMenuItem("退出");
        miQuit.Click += (_, _) => Quit();
        menu.Items.AddRange(new ToolStripItem[] { miShow, _miTopmost, _miClickThrough, _miAutostart,
            new ToolStripSeparator(), miQuit });

        _tray = new NotifyIcon
        {
            Text = "TODO · DAILY LOOP",
            Icon = CreateTrayIcon(),
            Visible = true,
            ContextMenuStrip = menu
        };
        _tray.DoubleClick += (_, _) => ToggleVisible();

        // 位置/尺寸变化后防抖保存
        _savePosTimer.Tick += (_, _) =>
        {
            _savePosTimer.Stop();
            if (WindowState == FormWindowState.Normal)
            {
                _settings.X = Location.X;
                _settings.Y = Location.Y;
                _settings.Width = Width;
                _settings.Height = Height;
                _settings.Save();
            }
        };
        LocationChanged += (_, _) => _savePosTimer.Restart();
        SizeChanged += (_, _) => _savePosTimer.Restart();

        Load += async (_, _) => await InitWebViewAsync();
    }

    // ---------- WebView2 ----------

    private async Task InitWebViewAsync()
    {
        try
        {
            // WebView2 用户数据放到 %APPDATA%，避免在 exe 旁生成目录
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "TodoDailyLoop", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await _webView.EnsureCoreWebView2Async(env);

            var core = _webView.CoreWebView2;
            core.WebMessageReceived += OnWebMessageReceived;
            // 把 wwwroot 映射为虚拟主机，避免 file:// 的各种限制
            core.SetVirtualHostNameToFolderMapping(
                "todo.local",
                Path.Combine(AppContext.BaseDirectory, "wwwroot"),
                CoreWebView2HostResourceAccessKind.Allow);
            core.Navigate("https://todo.local/index.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "WebView2 初始化失败。请安装 Microsoft Edge WebView2 Runtime 后重试。\n\n" + ex.Message,
                "TODO · DAILY LOOP", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Quit();
        }
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString();
            switch (type)
            {
                case "ready":
                    _webReady = true;
                    SendInit();
                    break;
                case "save":
                    SaveData(root.GetProperty("data").GetRawText());
                    break;
                case "drag":
                    Win32.BeginCaptionDrag(Handle);
                    break;
                case "setTopmost":
                    SetTopmost(root.GetProperty("value").GetBoolean(), notifyWeb: false);
                    break;
                case "setClickThrough":
                    SetClickThrough(root.GetProperty("value").GetBoolean(), notifyWeb: false);
                    break;
                case "setAutostart":
                    SetAutostart(root.GetProperty("value").GetBoolean(), notifyWeb: false);
                    break;
                case "setWideMode":
                    SetWideMode(root.GetProperty("value").GetBoolean());
                    break;
                case "enterMini":
                    EnterMini(root.GetProperty("height").GetInt32());
                    break;
                case "exitMini":
                    ExitMini();
                    break;
                case "miniHeight":
                    UpdateMiniHeight(root.GetProperty("height").GetInt32());
                    break;
                case "minimize":
                    Hide();
                    break;
                case "quit":
                    Quit();
                    break;
            }
        }
        catch
        {
            // 忽略无法解析的消息
        }
    }

    private void PostToWeb(object payload)
    {
        if (!_webReady || _webView.CoreWebView2 is null) return;
        _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(payload));
    }

    private void SendInit()
    {
        string data = "null";
        try
        {
            if (File.Exists(_dataFile)) data = File.ReadAllText(_dataFile);
        }
        catch { /* 读取失败按空数据处理 */ }

        // data 可能是任意 JSON，用 RawValue 原样透传
        var raw = JsonSerializer.SerializeToElement(new
        {
            type = "init",
            data = JsonSerializer.Deserialize<JsonElement>(string.IsNullOrWhiteSpace(data) ? "null" : data),
            settings = CurrentSettingsPayload()
        });
        PostToWeb(raw);
    }

    private object CurrentSettingsPayload() => new
    {
        topmost = _settings.Topmost,
        clickThrough = _settings.ClickThrough,
        autostart = Autostart.IsEnabled(),
        wideMode = _settings.WideMode
    };

    private void SaveData(string rawJson)
    {
        try
        {
            File.WriteAllText(_dataFile, rawJson);
            PostToWeb(new { type = "saved", time = DateTime.Now.ToString("HH:mm") });
        }
        catch
        {
            // 写盘失败时静默，下次操作会重试
        }
    }

    // ---------- 开关 ----------

    private void SetTopmost(bool value, bool notifyWeb)
    {
        _settings.Topmost = value;
        _settings.Save();
        TopMost = value;
        if (_miTopmost.Checked != value) _miTopmost.Checked = value;
        if (notifyWeb) PostToWeb(new { type = "settings", settings = CurrentSettingsPayload() });
    }

    private void SetClickThrough(bool value, bool notifyWeb)
    {
        _settings.ClickThrough = value;
        _settings.Save();
        Win32.SetClickThrough(Handle, value);
        if (_miClickThrough.Checked != value) _miClickThrough.Checked = value;
        if (notifyWeb) PostToWeb(new { type = "settings", settings = CurrentSettingsPayload() });
    }

    private void SetAutostart(bool value, bool notifyWeb)
    {
        try { Autostart.SetEnabled(value); } catch { /* 注册表不可写时忽略 */ }
        if (_miAutostart.Checked != value) _miAutostart.Checked = value;
        if (notifyWeb) PostToWeb(new { type = "settings", settings = CurrentSettingsPayload() });
    }

    private void SetWideMode(bool wide)
    {
        // 仅记录管理页偏好，不再调整窗口宽度（窗口尺寸完全由用户拖拽决定）
        _settings.WideMode = wide;
        _settings.Save();
    }

    // ---------- Mini 模式（窗口高度贴合列表内容，宽度不变） ----------

    /// <summary>把 JS 报的 CSS 像素内容高度换算为窗口物理高度（含四周缩放手柄 Padding）。</summary>
    private int MiniWindowHeight(int contentHeight)
    {
        var scaled = (int)Math.Ceiling(contentHeight * (DeviceDpi / 96.0));
        var h = Math.Max(scaled + Padding.Vertical, MiniMinHeight);
        // 不超出当前屏幕工作区底边
        var area = Screen.FromPoint(Location).WorkingArea;
        return Math.Min(h, Math.Max(MiniMinHeight, area.Bottom - Location.Y));
    }

    private void EnterMini(int contentHeight)
    {
        if (_preMiniBounds is null)
        {
            // 记住进入前的位置和高度，退出时恢复
            _preMiniBounds = Bounds;
            MinimumSize = new Size(300, MiniMinHeight);
        }
        SetBounds(Location.X, Location.Y, Width, MiniWindowHeight(contentHeight));
    }

    private void UpdateMiniHeight(int contentHeight)
    {
        if (_preMiniBounds is null) return;
        var h = MiniWindowHeight(contentHeight);
        if (Height != h) SetBounds(Location.X, Location.Y, Width, h);
    }

    private void ExitMini()
    {
        if (_preMiniBounds is not Rectangle b) return;
        _preMiniBounds = null;
        var h = Math.Max(b.Height, 400);
        var area = Screen.FromPoint(b.Location).WorkingArea;
        var y = Math.Clamp(b.Y, area.Top, Math.Max(area.Top, area.Bottom - h));
        SetBounds(b.X, y, Width, h);
        MinimumSize = new Size(300, 400);
    }

    // ---------- 窗口行为 ----------

    private void ToggleVisible()
    {
        if (Visible) { Hide(); }
        else { Show(); WindowState = FormWindowState.Normal; Activate(); }
    }

    private void Quit()
    {
        _reallyExit = true;
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // 关闭按钮（Alt+F4 等）最小化到托盘
        if (!_reallyExit && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            return;
        }
        _settings.X = Location.X;
        _settings.Y = Location.Y;
        _settings.Width = Width;
        _settings.Height = Height;
        _settings.Save();
        base.OnFormClosing(e);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (_settings.ClickThrough) Win32.SetClickThrough(Handle, true);
    }

    /// <summary>无边框窗口的四边/四角缩放命中测试。</summary>
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Win32.WmNchitTest)
        {
            base.WndProc(ref m);
            if ((int)m.Result == Win32.HtClient)
            {
                var p = PointToClient(new Point((int)(m.LParam.ToInt64() & 0xFFFF), (int)(m.LParam.ToInt64() >> 16)));
                bool l = p.X < ResizeGrip, r = p.X >= Width - ResizeGrip;
                bool t = p.Y < ResizeGrip, b = p.Y >= Height - ResizeGrip;
                if (l && t) m.Result = (IntPtr)Win32.HtTopLeft;
                else if (r && t) m.Result = (IntPtr)Win32.HtTopRight;
                else if (l && b) m.Result = (IntPtr)Win32.HtBottomLeft;
                else if (r && b) m.Result = (IntPtr)Win32.HtBottomRight;
                else if (l) m.Result = (IntPtr)Win32.HtLeft;
                else if (r) m.Result = (IntPtr)Win32.HtRight;
                else if (t) m.Result = (IntPtr)Win32.HtTop;
                else if (b) m.Result = (IntPtr)Win32.HtBottom;
            }
            return;
        }
        base.WndProc(ref m);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _tray.Visible = false;
            _tray.Dispose();
            _savePosTimer.Dispose();
            _webView.Dispose();
        }
        base.Dispose(disposing);
    }

    /// <summary>运行时绘制托盘图标：蓝色圆角方块 + 白色对勾。</summary>
    private static Icon CreateTrayIcon()
    {
        var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var brush = new SolidBrush(Color.FromArgb(0x5E, 0xA8, 0xFF));
            using var path = RoundedRect(new Rectangle(1, 1, 30, 30), 8);
            g.FillPath(brush, path);
            using var pen = new Pen(Color.White, 4f) { StartCap = System.Drawing.Drawing2D.LineCap.Round, EndCap = System.Drawing.Drawing2D.LineCap.Round };
            g.DrawLines(pen, new[] { new Point(9, 16), new Point(14, 21), new Point(23, 11) });
        }
        var icon = Icon.FromHandle(bmp.GetHicon());
        return icon;
    }

    private static System.Drawing.Drawing2D.GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        var path = new System.Drawing.Drawing2D.GraphicsPath();
        int d = radius * 2;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

/// <summary>System.Windows.Forms.Timer 便捷扩展。</summary>
internal static class TimerExtensions
{
    public static void Restart(this System.Windows.Forms.Timer timer)
    {
        timer.Stop();
        timer.Start();
    }
}
