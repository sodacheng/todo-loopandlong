using System.Text.Json;

namespace TodoDailyLoop;

/// <summary>外壳设置：窗口位置/尺寸、置顶、点击穿透、开机自启。持久化到 %APPDATA%\TodoDailyLoop\settings.json。</summary>
internal sealed class ShellSettings
{
    public int X { get; set; } = -1;
    public int Y { get; set; } = -1;
    public int Width { get; set; } = 360;
    public int Height { get; set; } = 520;
    public bool Topmost { get; set; }
    public bool ClickThrough { get; set; }
    public bool Autostart { get; set; }
    /// <summary>上次是否停留在任务管理视图（仅恢复视图用，不影响窗口尺寸）。</summary>
    public bool WideMode { get; set; }

    private static readonly string DirPath =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TodoDailyLoop");

    private static readonly string FilePath = Path.Combine(DirPath, "settings.json");

    public static ShellSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var s = JsonSerializer.Deserialize<ShellSettings>(File.ReadAllText(FilePath));
                if (s is not null) return s;
            }
        }
        catch
        {
            // 设置损坏时静默回退默认值
        }
        return new ShellSettings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(DirPath);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this));
        }
        catch
        {
            // 写盘失败不影响使用
        }
    }
}
