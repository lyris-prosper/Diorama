# 结构

## 运行方式

工作台只在本机运行：`npm start` 启动 Vite 开发服务器（vinext 提供 Next 风格的 `app/` 路由），服务端代码跑在 Cloudflare 的本地 Worker 运行时里（Miniflare）。

- **数据库**：D1（SQLite），一张 `projects` 表存每个空间的 JSON；`jobs` 和 `job_charges` 记录付费任务与扣费。迁移在 `drizzle/*.sql`，启动时由 wrangler 应用。
- **文件**：R2（本地模拟），存照片、掩膜、修复结果、房间 `.spz`、家具 `.glb`。键名以空间 id 开头；通过照片指纹复用的房间文件保留在最早生成它的空间目录下，读取权限按“文件在自己的空间里，或被自己的空间引用”判断（`app/api/assets/route.ts`）。
- **数据位置**：`.wrangler/state/`。`vite.config.ts` 里的数据库 id 和存储桶名决定数据在哪里，不能改。
- **本机辅助服务**：开发服务器里只允许本机访问的中间件。
  - `build/local-vision-plugin.mjs`：识别和背景修复，在独立子进程里运行，有内存门槛和超时。
  - `build/local-model-plugin.mjs`：压缩生成的 GLB。
  - `build/local-relay-plugin.mjs`：把 World Labs 和 Tripo 请求经系统代理转发，因为 Worker 运行时不能直接用 HTTP 代理。

## 流程

| 环节 | 实现 | 文件 |
|---|---|---|
| 识别家具 | DETR（检测）+ SlimSAM（像素轮廓），ONNX Runtime 在 Node 子进程里运行 | `scripts/local-vision-worker.mjs`、`public/vision/inference.mjs` |
| 手动修正 | 多边形 → Canvas 掩膜 | `components/editor/Workbench.tsx` |
| 抠图 | 掩膜逐像素抠出透明 PNG | `lib/image.ts` |
| 背景修复 | LaMa，只修家具周围裁出的区域，保持原分辨率，羽化贴回 | `scripts/local-vision-worker.mjs` |
| 3D 房间 | World Labs Marble 草稿生成；或导入 Marble 官网的房间 | `lib/server/providers.ts`、`app/api/workbench/route.ts` |
| 同照片复用 | 64 位差异哈希，汉明距离 ≤ 8 视为同一张照片 | `set-print` |
| 演示卧室 | 照片 SHA-256 或指纹匹配时，直接用预设的 Marble 1.1 房间和底图 | `lib/demo-room.ts`、`lib/server/demo.ts` |
| 家具模型复用 | 同一张家具照片（SHA-256 相同）已高精度生成过模型时直接复用（演示用的床和吊灯模型在 `public/demo/`），不建 Tripo 任务；标准设置的旧模型不复用 | `reusableModel`（`lib/server/demo.ts`） |
| 地面与比例 | 从碰撞网格或 splat 点云找地面和天花板，换算成米 | `components/editor/Scene.tsx` |
| 擦除原家具 | 打开“挪动原家具”后点家具：擦除框从扫描自动贴合（见下）；框内的 splat 隐藏，空房间底图只在框内显示，自动对齐（平面图 FFT 互相关） | `lib/fit-box.ts`、`Scene.tsx`、`lib/align-clean.ts` |
| 家具 3D | Tripo H3.1 图生模型：精细几何（`geometry_quality: detailed`）、8K PBR 贴图（`texture_quality: extreme`、`pbr`），约 70 积分。下载 PBR 版本，房间里用 4K 副本（底色 4096、法线 2048、金属度/粗糙度 1024，20 万面，大件 40 万面，meshopt），8K 原件保留可下载。已完成的家具可以重新生成（同一任务记录新一次尝试，之前的扣费保留） | `lib/server/provider-http.ts`、`lib/server/jobs.ts`、`scripts/optimize-glb.mjs` |
| 模型尺寸 | 填写的尺寸和照片比例一致（各轴缩放比相差 ≤ 30%）时按三轴分别缩放；不一致时取中位数等比缩放，保留造型（例如带吊杆的吊灯只填了灯罩高度） | `lib/fit-model.ts`、`Scene.tsx` |
| 摆放 | 见下节 | `lib/placement.ts`、`Scene.tsx` |
| 家具库 | 20 件商品的预处理模型和数据；“帮我找”把一句话解析成筛选条件 | `lib/catalog.json`、`lib/catalog-search.ts` |

## 摆放规则（`lib/placement.ts`）

房间是 Gaussian splat 扫描，扫描里的书桌、衣柜都不是网格。房间加载后，用较轻的 `.spz` 的 splat 中心建一个 5 cm × 5 cm × 2.5 cm 的占用网格，约 40 ms 建好，每次查询不到 1 ms。

指针射线会在三类对象里找最先碰到的那个：已摆放的家具网格、扫描网格、地平面。

- **朝上的面**（地面、桌面、床面、窗台）：家具放在那里。
- **家具网格的侧面**：从这件家具上方向下探测，放到它的顶上。
- **扫描里的侧面**：沿这一列向上找台面，只接受低于视线的台面。
- **墙、衣柜门、天花板**：不放；拖动中的家具停在上一个合法位置。
- **擦除框**：框内对扫描透明。

压在一件家具上的东西（向下短探测会碰到它）会被当作它的“乘客”，随它移动和旋转。家具收回或删除时，乘客落到下面的表面；家具缩放后，乘客重新放到它的新顶面上。

**天花板和吊挂**（`buildCeiling`）：用同一份 splat 中心，地面以上 1.9–4.5 m 里点最密的水平层是主天花板；每个 10 cm 格子取 3×3 邻域里最低、且不少于最密层一半的水平层，所以窗边比天花板低的吊顶梁能在原位认出来。扫描里没有天花板时按地面加 2.7 m。吊挂的家具（`mount: "ceiling"`，或类别是吊灯、名字里有吊灯 / pendant）顶端贴着所在位置的天花板；拖动时射线和天花板高度的平面求交，沿天花板移动，与天花板的距离保持不变；缩放时顶端不动。吊挂的家具不承载别的家具。

**墙的朝向**（`wallHeading`）：地面以上 1.2–2 m 的 splat 中心（高过床和书桌、低于天花板）投影到家具的两条边方向上，按 4 cm 统计直方图；墙是直线，转到对的角度时直方图最尖。0–90° 每 0.5° 试一次，再在最好的角度附近按 0.1° 细调；哪个角度都不突出（没有清楚的墙）时不给结果。新放下的家具（家具库拖进来的、家具栏第一次摆放的）转到离 0° 最近、和墙对齐的角度，之后“旋转”每次 15°，转 90° 又回到对齐。演示卧室算出 20.0°，与床的擦除框一致，约 30 ms。

## Safari

Safari 17（macOS 14.5，Apple M3 上实测）的 JavaScriptCore 在两个 Web Worker 同时第一次运行 Spark 的 WebAssembly SIMD 代码时会崩溃（崩溃报告里是 `slow_path_wasm_simd_go_straight_to_bbq_osr` 里的 `WTFCrash`）。做法：
- `SparkRenderer({ enableLod: false })`：这里的房间没有细节层级数据，不开它的驱动线程，少一个从第一帧起就运行的 Worker。
- 空房间底图在房间文件解码完、第一次排序之后（约 1.2 秒）才开始加载，两个房间文件不会同时解码。
- 页面不再提示“请用 Chrome”。

## 擦除框自动贴合（`lib/fit-box.ts`）

点中的位置附近（2.4 m 内）、地面以上 6 cm 到天花板以下的 splat 中心按 4 cm 体素计数，3×3×3 邻域里中心太少的体素算漂浮噪点，丢掉。在半高（0.9–1.5 m）和天花板下方都有点的列是“结构”：墙、窗帘、到顶的柜子；这些列外扩一格后不参与生长，所以靠墙的床不会长进墙里。从点击处最近的体素开始做 26 邻接生长；家具的平面占地取凸包，再用旋转卡壳求最小面积矩形，得到朝向和长宽，最高的体素给出高度。宽度取横对视线的那条边，和量家具的习惯一致；按尺寸猜类别。演示卧室的扫描上，点床的任意位置得到的框和手工标定的框平面 IoU 为 0.87–0.88，角度相差 1°，约 30 ms。点在墙、窗帘或空中时不给框，退回默认方框。

## 演示卧室（`lib/demo-room.ts`）

- **识别**：上传的原图 SHA-256（在上传键名里）等于演示照片，或照片指纹距离 ≤ 8，就把预设房间给这个空间：Marble 1.1 房间、空房间底图（含对齐参数）、已校准的地面，阶段直接是 `ready`，没有擦除。
- **文件**：4 个 `.spz` 放在 R2 的 `presets/bedroom/`，不属于任何空间。`ensureDemoFiles()` 先从本机原有的键复制，没有就从 Marble 公开 CDN 下载（免费）；启动脚本会在服务就绪后调用 `prepare-demo` 提前准备。资产接口对 `presets/` 放行，删除空间永远不碰 `presets/`。
- **床**：已生成的床模型和缩略图在 `public/demo/`，静态提供。点在床的擦除框范围内时，编辑面板预填床的类别、尺寸和擦除框；上传的床照片 SHA-256 相同（或指纹 ≤ 6）时，`edit-furniture` 直接放回这个模型（按原来的摆位和朝向），不建任务、不预留积分。其他照片如果以前用 Tripo 生成过，也会从 `jobs` 记录里找到原模型复用。

## 中英文（`lib/i18n.ts`）

- 页面文字都写成 `t("中文", "English")`，表格类文字写成 `{ zh, en }` 或 `name / nameEn`。语言存在浏览器 localStorage，第一次访问按浏览器语言；服务端先渲染中文，水合后再切换（`useSyncExternalStore`），不会出现水合不一致。
- 请求带 `x-lang` 头。服务端的提示用 `say(中文, English)`（`lib/server/say.ts`），按请求语言返回；生成任务的错误把英文写在 `jobs.result.errorEn`。本机识别助手的进度和错误是 `{ zh, en }`。
- `tests/i18n.mjs` 检查页面里每段中文都有英文对照，服务端抛给用户的错误都带英文。

## 首页模型（`components/editor/Maquette.tsx`）

木作底板上的一间卧室：程序生成的房间、矮床、藤编休闲椅、植物、镜子、地毯，加上家具库里 17 件商品自己的 3D 模型（落地的几件悬停显示价格）。阳光从窗户照进来，有光柱和浮尘；“白天 / 黄昏”切换时，书桌台灯、矮柜上的布罩台灯、灯串和烛光亮起。画面不在视野内或标签页隐藏时停止渲染；系统设置了“减少动态效果”时不播放动画。

## 付费任务（`lib/server/jobs.ts`、`job-budget.ts`、`provider-http.ts`）

- 入队时先按预计积分预留，超出本地预算上限就不建任务。
- 提交请求从不自动重发。明确被拒会释放预留；无法确认是否已创建的任务进入“待核对”，禁止再次提交。
- 查询失败时有限次重试；等待超时只保留任务编号，之后继续查询原任务。
- 实际扣费按服务商返回的明细记账，World Labs 和 Tripo 统一成一个数字。

## 测试

`npm test` 在内存 SQLite 和模拟存储上运行真实的路由与服务端代码，网络全部模拟：

- `tests/provider-workflow.mjs`：付费任务的状态机和记账。
- `tests/furniture-workflow.mjs`：白底照片、尺寸、添加家具、家具库加入。
- `tests/project-workflow.mjs`：空间列表、重命名、安全删除、照片指纹复用、擦除、底图对齐、导入、模型压缩、演示卧室、模型复用（只复用高精度）、重新生成、吊挂的保存、英文错误。
- `tests/catalog-search.mjs`：官网链接与价格的完整性检查，以及 48 句搜索（31 句中文、17 句英文）。
- `tests/i18n.mjs`：页面和服务端文字的中英文对照检查。
- `tests/placement.mjs`：合成房间里的落点、叠放和落下。
- `tests/fit.mjs`：合成房间里的擦除框自动贴合（贴墙的床、斜放的书桌、墙和窗帘、噪点）、天花板和吊顶梁、墙的朝向（转过的房间、没有墙的扫描）、模型按尺寸缩放。

`tests/harness.mjs` 是可复用的加载器：把服务端 TypeScript 放进模拟的 D1、R2 和 fetch 环境里运行。新的路由测试用它（目前是 `project-workflow`）。
