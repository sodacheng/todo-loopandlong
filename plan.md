请用 C# + WebView2 开发一个 Windows 原生桌面悬浮 TODO 工具，
名为「TODO · DAILY LOOP」。它是一个始终悬浮在桌面上的小卡片窗口，参考以下完整设计规范实现，
视觉风格必须 1:1 还原。(悬浮在桌面上，但不会顶置盖住其他前台正在使用的APP)

一、窗口与系统行为
========================
1. 无边框小窗（frameless），默认尺寸约 360×520，可拖动（顶部 Hero 区域作为拖拽区，
   JS 监听 mousedown 后通过 WebView2 消息通知 C# 外壳执行 Win32 拖动（ReleaseCapture + SendMessage HTCAPTION）），
   可调整大小，最小 300×400。
2. 支持「置顶 / 取消置顶」切换；支持点击穿透可选（Win32 WS_EX_TRANSPARENT 扩展样式）；窗口位置记忆，重启后恢复。
3. 开机自启动：提供设置开关，通过 Windows 注册表 Run 键
   （HKCU\Software\Microsoft\Windows\CurrentVersion\Run）实现。
4. 系统托盘：NotifyIcon 托盘图标 + 右键菜单（显示/隐藏、置顶开关、开机自启开关、退出）；
   点关闭按钮最小化到托盘而不是退出。
5. 数据持久化到本地 JSON 文件（%APPDATA%\todo-data.json）：渲染层 JS 通过 WebView2 消息
   把数据发给 C# 外壳写盘，每次操作后自动保存，底部显示「✓ 已自动保存 HH:MM」。
6. 双模式：小窗模式（今日待办）/ 大窗模式（左右双栏任务管理），右上角按钮切换，
   大窗模式下窗口自动加宽到约 640px。


二、设计语言（必须严格还原）
========================
【配色】浅色纸感主题：
- 背景 #FAFAF8 之类的暖白 surface，surface-muted 略深一档
- 主强调色 accent：清爽蓝色 #5EA8FF（hover 时 brightness(1.06)）
- 文本四级灰阶：t1 主文字近黑 / t2 次级 / t3 弱提示 / t4 禁用
- 警示 warning 琥珀色、危险 danger 红色、成功 positive 绿色
- 边框 1px 浅灰；强调用 color-mix 思路做 9%/24% 透明度的 accent-soft / accent-mid
- 全部颜色定义为 CSS 变量

【底纹】整个卡片背景铺一层点阵：radial-gradient 1px 圆点、17px 网格间距、
透明度 7%，营造工程图纸感。弹层（sheet）内也用同款底纹（5% 透明度）。

【Hero 横幅】顶部区域：
- 左侧：kicker 小字「TODO · DAILY LOOP」等宽字体（monospace）10.5px 大写、
  其中 DAILY LOOP 用 accent 色加粗；下方是 30px/800 主标题「今日待办」，
  「待办」二字用 accent 色；再下方等宽字体 11px 日期「2026-07-27 · 周一」
- 右侧 56% 区域是一个 Canvas「像素字符场」：字符集 .:+*#K▲，13px 间距网格，
  密度从左到右递增（左疏右密），字符大小 7-11px 随密度变化；
  关键交互：今日完成度越高，字符排布越整齐（variance 从 0.85 降到 0.17）、
  越清晰（opacity 0.3→0.52）；鼠标移动时字符产生排斥位移（半径 90px、力度 13px）。
  该区域用 mask-image 做从左到右的渐隐
- 右上角两个 30×30 圆角 8px 图标按钮：「＋」实心 accent 底创建任务、展开/收起切换
- Hero 底部 1.5px 边框分隔

【像素格进度条】22 个 7×7px、圆角 2px 的小方块横排（gap 4px），
未填充为 10% 灰，填充为 accent 蓝；完成一个任务时对应格子做弹跳动画
（scale .4→1.45→1，cubic-bezier(.3,1.6,.5,1)，400ms）。
右侧等宽字体显示「PROGRESS · 3/7」，数字 accent 加粗。

【漏做提醒条】圆角 10px 横条：warning 色 9% 底 + 38% 边框，左侧 7px 小方块，
文字「2 个循环任务上个周期（7月26日）未完成」，右侧等宽字体「去处理 →」，hover 上浮 1px。

【任务列表】
- 行：圆角 10px，padding 8×10，hover 背景 accent-soft（9% 蓝）
- 复选框 21×21 圆角 6px，1.6px 边框（accent 48% 混边框色）；hover 放大 1.1；
  勾选后 accent 实底 + 对勾 SVG 描边动画（stroke-dasharray 16，dashoffset 16→0，
  280ms 延迟 50ms）+ 整体 pop 弹跳（scale .7→1.22→1，350ms）
- 标题 13.5px；循环任务右侧挂等宽字体 tag（surface-muted 底），
  如「每日」「工作日」「周一/三/五」「1号/15号」
- 长期任务右侧挂 D-DAY 徽章：accent-soft 底正常、≤2 天 warning 底「2D」「D-DAY」、
  逾期 danger 底「逾期3D」；全部等宽字体 tabular-nums
- 小窗模式完成任务：行向右滑出（translateX(14px) + 淡出，300ms）后重渲染

【大窗管理页】左右双栏（窄屏单列），栏头 1.5px 深色下划线 +
等宽大写「PENDING 未完成」「DONE 已完成」+ accent 计数 ×N；
已完成任务划线（1.5px）；删除按钮需二次确认
（点一下变「确认删除」红底文字，2.6 秒无操作恢复垃圾桶图标）；
DONE 栏头右侧有「清除已归档长期任务 ×N」文字按钮。

【创建任务弹层】遮罩 20% 暗化，居中卡片 max-width 420px、圆角 14px、
同款点阵底纹，入场 rise 动画（translateY(12px)+淡入，220ms）。
表单字段：标题、备注 textarea、「循环任务/长期任务」分段选择器（选中态 accent 实底白字）、
循环周期下拉（每日/工作日/每周/每月）、按周期显示星期或日期的 chip 多选组
（等宽字体小方块，选中 accent-soft 底 + accent 边框文字）、长期任务截止日期 date 输入。
底部「取消 / 创建」双按钮，创建为 accent 主按钮。

【庆祝与反馈】今日任务全部完成时：全屏 Canvas 撒花（130 片蓝白色系 + 少量 #FFD98E
矩形纸屑，带旋转和左右摇摆，每天只撒一次）+ 底部胶囊 toast
（accent 底白字「今日任务全部完成，太棒了！」，上浮入场，自动消失）。
底部还有一条虚线分隔的脚注：等宽字体「LOOP · 自动循环 / ✓ 已自动保存 HH:MM / LONG · D-DAY 倒计时」。

【动效规范】所有 hover 上浮 1px、按压 scale(.94~.97)、过渡 150-200ms ease；
弹跳统一 cubic-bezier(.3,1.6,.5,1)；尊重 prefers-reduced-motion；
所有可交互元素有 accent 色 focus-visible 描边。

【字体】中西文 UI 用系统栈（PingFang SC / Microsoft YaHei）；
kicker、日期、进度数字、tag、徽章、脚注一律用 ui-monospace / Consolas 等宽字体，
数字开 tabular-nums。


三、任务数据模型与逻辑
========================
1. 任务类型：
   - recurring 循环任务：recur.kind = daily / workdays / weekly(weekdays 数组) /
     monthly(monthdays 数组，月末兜底：选了 31 号但当月只有 30 天则最后一天触发)。
     完成状态按日期记录 completions["YYYY-MM-DD"] = 时间戳，次日自动重置
   - longterm 长期任务：可设截止日期 due，完成后归档，不自动重置
2. 漏做检测：只检查任务创建日期之后的周期，找到最近一次应做未做的日期即提醒
3. 全部完成判定：今日循环任务全 done 且无未完成长期任务 → 撒花（每天一次）
4. 数据结构示例：{ id, type, title, note, recur, due, completions, done, doneAt, createdAt }


四、技术架构与交付要求
========================
- 外壳：.NET 8 + WinForms，内嵌 WebView2 控件（Microsoft.Web.WebView2 NuGet 包）。
  C# 外壳负责：无边框窗口与拖动、缩放、系统托盘、开机自启、置顶/点击穿透（Win32 API）、
  窗口位置记忆、JSON 数据文件读写
- UI：原生 HTML/CSS/JS（不引框架），放在 wwwroot/ 目录下，由 WebView2 加载渲染。
  设计规范（第二章）全部在这一层实现，与 Web 版完全一致
- 前后端通信：JS 侧 window.chrome.webview.postMessage / addEventListener('message')，
  C# 侧 CoreWebView2.WebMessageReceived / PostWebMessageAsJson。
  消息类型至少覆盖：读取数据、保存数据、置顶切换、点击穿透切换、开机自启切换、
  窗口拖动、退出/最小化到托盘
- 无 Node.js / npm / Rust 依赖，构建只需 .NET 8 SDK；
  dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true
  产出单文件 exe，双击即用（WebView2 Runtime 在 Win11 及多数 Win10 已内置，
  README 需提供未安装时的引导说明）
- 代码结构清晰：Program.cs（入口）/ MainForm.cs（窗口 + 托盘 + 系统集成 + 消息桥）/
  wwwroot（index.html + app.js + styles.css）
- README 说明如何发布单文件 exe 与设置开机自启
