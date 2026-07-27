# TODO · DAILY LOOP

Windows 原生桌面悬浮 TODO 工具：.NET 8 WinForms 无边框窗口 + WebView2 渲染的原生 HTML/CSS/JS 界面。

- 三种视图右上角按钮循环切换：今日待办 → 任务管理（双栏）→ Mini（只留任务列表，窗口高度自动贴合内容）；切换视图不改变窗口宽度，尺寸完全由用户拖拽决定
- 循环任务（每日 / 工作日 / 每周 / 每月，月末兜底）、长期任务（D-DAY 倒计时）
- 漏做提醒、像素格进度条、全部完成撒花庆祝
- 系统托盘（显示/隐藏、置顶、点击穿透、开机自启、退出），关闭最小化到托盘
- 数据持久化到 `%APPDATA%\todo-data.json`，每次操作自动保存

## 项目结构

```
TodoDailyLoop.csproj   项目文件（WebView2 NuGet 包、wwwroot 复制到输出目录）
Program.cs             入口
MainForm.cs            窗口 + 托盘 + 系统集成 + WebView2 消息桥
Win32.cs               Win32 API（拖动 / 点击穿透 / 无边框缩放）
ShellSettings.cs       窗口位置等外壳设置（%APPDATA%\TodoDailyLoop\settings.json）
Autostart.cs           注册表 Run 键开机自启
wwwroot/               渲染层（index.html + app.js + styles.css，无框架）
```

## 构建与发布

需要 .NET 8 SDK。调试运行：

```bash
dotnet run
```

发布单文件 exe（自包含，无需目标机器安装 .NET）：

```bash
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true
```

产物在 `bin/Release/net8.0-windows/win-x64/publish/`，其中 `TodoDailyLoop.exe`
为单文件可执行程序。

## 分发（zip）

项目根目录的 `TodoDailyLoop-win-x64.zip` 为最小分发包，仅含三样：

- `TodoDailyLoop.exe`（单文件、自包含 .NET 8 运行时）
- `WebView2Loader.dll`（WebView2 本机加载器，必须与 exe 同级）
- `wwwroot/`（`index.html` + `app.js` + `styles.css`，界面资源，必须与 exe 同级）

解压到任意目录运行 `TodoDailyLoop.exe` 即可（目标机器需有 WebView2 Runtime，见下节）。
publish 目录里的 `.pdb` / `.xml` / `*_cor3.dll` 均为调试符号或 WebView2 包附带的
WPF 程序集产物，WinForms 应用用不到，不进入分发包。

## WebView2 Runtime 缺失时

应用界面依赖 Microsoft Edge WebView2 Runtime。Windows 11 及多数
Windows 10 已内置；若启动时弹出「WebView2 初始化失败」提示，请到微软官网下载安装常青版引导程序：

https://developer.microsoft.com/microsoft-edge/webview2/

下载「Evergreen Bootstrapper」运行即可（需联网，安装后永久生效）。

## 开机自启

两种方式任选：

- 应用内：右键托盘图标 → 勾选「开机自启」。写入注册表
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 的 `TodoDailyLoop` 键，取消勾选即删除。
- 手动：将 exe 的快捷方式放入 `shell:startup`（Win+R 输入）文件夹。

## 数据与设置文件

| 文件 | 内容 |
| --- | --- |
| `%APPDATA%\todo-data.json` | 任务数据（渲染层每次变更后自动写盘） |
| `%APPDATA%\TodoDailyLoop\settings.json` | 窗口位置/尺寸、置顶、点击穿透、大窗模式 |
| `%APPDATA%\TodoDailyLoop\WebView2\` | WebView2 用户数据目录 |

## 前后端消息协议

JS → C#（`window.chrome.webview.postMessage`）：

| type | 载荷 | 说明 |
| --- | --- | --- |
| `ready` | — | 页面就绪，请求初始数据与设置 |
| `save` | `{data}` | 任务数据变更，写盘 |
| `drag` | — | Hero 拖拽区按下，外壳执行 Win32 拖动 |
| `setTopmost` | `{value}` | 置顶开关 |
| `setClickThrough` | `{value}` | 点击穿透开关 |
| `setAutostart` | `{value}` | 开机自启开关 |
| `setWideMode` | `{value}` | 记录是否停留在任务管理视图（仅持久化偏好，不再调整窗口尺寸） |
| `enterMini` | `{height}` | 进入 Mini 模式：外壳记住当前位置与高度，窗口高度收缩到贴合内容（宽度不变） |
| `exitMini` | — | 退出 Mini 模式：恢复进入前的窗口位置与高度 |
| `miniHeight` | `{height}` | Mini 模式下内容高度变化（勾选、切日重置等），外壳同步收缩窗口 |
| `minimize` | — | 最小化到托盘 |
| `quit` | — | 退出应用 |

C# → JS（`PostWebMessageAsJson`）：

| type | 载荷 | 说明 |
| --- | --- | --- |
| `init` | `{data, settings}` | 初始任务数据与外壳设置 |
| `saved` | `{time}` | 写盘确认，脚注显示「✓ 已自动保存 HH:MM」 |
| `settings` | `{settings}` | 托盘菜单改动后同步给渲染层 |
