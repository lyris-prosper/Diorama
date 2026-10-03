# 房间工作台

独立项目：`/workspace/scratch/1042365730b1/room-editor-mvp`。

这是直接进入工作台的 React + TypeScript + Three.js 应用，没有品牌、Logo 或营销首页。代码使用 Sites / Vinext 的 Cloudflare Workers 架构，D1 保存项目和任务，R2 保存用户原图及生成资产。源代码同步到该私有 Site 的 Git 仓库。

## 当前交付状态

- 已实现：工作台、上传、互斥的“删除”与“保留为可编辑家具”分支、空房快捷选项、候选实例勾选、真实像素掩膜叠加、手动多边形圈选、对象提取、原始裁切留存、处理结果复核、异步任务表与单项重试、服务余额查看。
- 已实现：示例床/书桌/柜子的真实 Three.js 网格、共享渲染器缩略图、拖放与点击地面放置、选择、地面拖动、绕 Y 轴旋转、等比缩放、初始高度校准、收回、移除、撤销/重做、后端保存与刷新恢复。
- 已接入代码：SAM 3 / Bria Eraser、World Labs、Tripo v3。**适配代码存在不等于真实端到端验收通过。**
- 实测：类型检查通过、生产构建通过、12 项本地 API 检查通过。World Labs 原图空间生成实际成功，230 积分，返回 100k/500k/full SPZ 与 collider GLB。真实结果保存在 `resources/validation/`。
- 阻塞：没有 `FAL_KEY`，识别和修复未进行真实调用；A/B 未完成。Tripo 余额实测有效，未提交建模任务。真实 SPZ 与 Tripo GLB 的混合渲染、实际拖拽和目标 M3 设备帧率均未通过浏览器实测。
- 浏览器环境拒绝访问预览入口，未获得 UI 截图；不把代码检查当作浏览器验收。详见 [验证记录](docs/VALIDATION.md)。

## 本地启动

建议 Node.js 22.13+，npm；常规本地开发无需 GPU。

```bash
cd room-editor-mvp
npm ci
cp .env.example .dev.vars
# 用本机编辑器填写 .dev.vars，不要把密钥写入前端或提交 Git
npm run db:local
npm run dev
```

以终端打印的本地地址为准。当前交付环境使用受管理的预览服务；普通机器可使用 `npm run dev:local`（Vite，默认 5173）。`.dev.vars` 由 Cloudflare 插件读取，且已被 Git 忽略。

```bash
npm run typecheck
npm run build
```

`npm run test:api` 用于已有本地测试服务器（默认 `http://127.0.0.1:4173`）。测试照片通过 `TEST_IMAGE` 指定；默认使用本次附件路径。该测试不调用付费生成。

## 安全配置

| 后端变量 | 用途 | 当前状态 |
|---|---|---|
| `WORLDLABS_API_KEY` | 房间生成、余额、任务查询 | 已配置为 Site secret；只读余额及一次真实生成成功 |
| `TRIPO_API_KEY` | 单件图片上传、3D 模型生成及查询 | 已配置为 Site secret；余额读取成功，建模未实测 |
| `FAL_KEY` | SAM 3 实例分割、Bria Eraser 背景擦除 | **尚未配置，这是 A/B 的主要凭据阻塞** |
| `WORLDLABS_CREDIT_LIMIT` | 本应用剩余世界生成预算上限 | 默认 6770；本次烟测已经用了 230 |

在本私有 Site 的后端环境配置中添加 `FAL_KEY`，标记为 Secret，然后重新部署使其生效。可以在本机 `.dev.vars` 中配置来做本地联调。不要把密钥粘贴到聊天、上传到公开仓库、使用 `NEXT_PUBLIC_*` 或 `VITE_*` 前缀。

fal.ai Key 从其控制台创建：<https://fal.ai/dashboard/keys>。该服务单独计费，不使用 Tripo 或 World Labs 积分。SAM 3 与 Bria 模型的托管条款以服务页面为准。

## 目录

```text
app/                     页面、全局样式、私有 API 路由
components/editor/       工作台与 Three.js 场景
lib/types.ts             项目、家具、实例与任务类型
lib/image.ts             掩膜合并、抠图、裁切、严格保留未选区域
lib/server/              存储、模型适配器、恢复式任务调度
db/schema.ts             D1 schema
drizzle/                 可审阅、版本化的数据库迁移
resources/validation/    已付费真实空间的验证资产，不在 public 中
scripts/                 启动、构建、可恢复的服务烟测工具
tests/                   本地 API 验证
docs/                    验证、架构、第三方来源及限制
.env.example             无密钥的变量模板
.openai/hosting.json     Site ID 与逻辑 D1/R2 绑定
```

## 流程与费用

1. 上传房间照片；未填写描述不会默认处理全部。
2. 删除分支只修复背景，不排队任何 Tripo 任务；编辑分支保存选择的原始裁切、像素掩膜与单件白底输入图。
3. SAM 3 通过家具词汇检测多个实例。候选默认不勾选；同类多个对象必须由用户确认。方位词不会被静默猜测，MVP 会展示同类候选让用户点击对应实例。
4. 合并确认掩膜并膨胀 4 px，以覆盖边缘。Bria Eraser 根据掩膜修复。随后浏览器将掩膜外像素逐一替换回原图，计算原始修复结果对未选区域的平均变化，并要求人工复核残影和误删。
5. 复核后才调用 World Labs；仅编辑分支调用 Tripo。空房/不处理家具直接跳过分割、擦除和 Tripo。
6. 默认使用 `marble-1.0-draft`，单次预留 250 积分，本次实际 230。Tripo 使用 `v3.1-20260211`、标准纹理/PBR，保守预留每件 100 积分；累计预留达到 5000 时拒绝新任务。不会调用收费 HQ mesh 导出。
7. 完成后把远端资产缓存到 R2，应用只使用同源私有资产路由，不依赖临时 CDN URL。

## 数据与恢复

项目按登录用户隔离，所有资产读写先检查项目所有权。私有 Site 的认证网关注入用户身份；仅开发模式允许本地测试身份。生产环境没有匿名后门。原图与资产在 R2，D1 存结构化项目、选择、布局、服务商任务 ID、状态、失败原因和预算预留。布局以“保存”为提交点，离开前有未保存提醒。

任务创建采用确定的 ID / 数据库约束防止重复生成；同时最多提交 2 个任务，单项最多 3 次尝试。轮询只查询现有服务商任务，不随刷新重新创建。提交结果不明时标记 `uncertain` 并停止自动重发，避免重复扣费；这种状态需通过服务商控制台核对。任务已明确失败可单独重新生成；资产下载失败只重新获取原任务输出。预算采用保守累计预留，失败不会自动释放，避免意外超支。

调度由打开页面后的轮询推进，关闭页面时尚未提交的任务暂不推进；已在服务商运行的任务不受影响。重开项目后恢复。当前未提供 Cloudflare Queue/cron 的全天候后台执行。

## 3D 资产与性能

空间是 SPZ，使用 Spark 与 Three.js 混合；碰撞 GLB 与视觉空间分别保存。不会把 collider 当成有纹理房间。读取 `semantics_metadata` 的比例与地面偏移，再做 OpenCV→Three.js 的 X 轴 180° 转换。缺失元数据时必须手动确认地面；本次真实返回的元数据为空。

家具 GLB 按包围盒进行底部原点对齐、估计高度标准化，再由实例 transform 控制。陈列缩略图的相机距离不影响实际家具比例。屏幕仅一个 WebGL renderer，使用一次性渲染缩略图。默认 100k splats、DPR 上限 1.5、渲染上限约 33 fps、1024 阴影、懒加载 Spark。未测量 Apple M3 的实际帧率。

当前采用用户确认的有限水平平面进行拾取，未使用 collider 自动提取房间可走区域或墙体碰撞。房间 splat 与实体家具的实际遮挡质量仍需要真实浏览器验收。没有家具物理仿真或自动恢复原位置。

## 明确限制

- 缺 FAL_KEY 时自动识别/修复会明确阻塞；手动圈选是真实像素掩膜，但**不能替代缺失的背景修复服务**。
- 没有多模态 LLM 的通用自然语言推理。支持床、桌、独立柜、椅、沙发和全部可移动家具的规则词汇；方位歧义由用户实例确认解决。固定结构不在默认检测词汇中。
- 未实现遮挡家具的生成式补全。严重残缺的裁切应返回重选或更换照片，不能认为准确建模。
- 背景修复只保证掩膜外像素保留；掩膜内部生成内容、边缘残影、漏分或误分需检查。暂无自动语义残留检测。
- 示例资产是几何模型，明确标注，与真实生成隔离。真实混合渲染和两条完整链路尚未验收。

## 2026-10-03 UI and automatic recognition update

Uploads now automatically start a dedicated browser worker. DETR identifies furniture and SlimSAM estimates pixel contours, without a `FAL_KEY` or inference API charge. Model weights and WASM runtime are bundled on the same site, so the browser does not depend on accessing Hugging Face or a CDN. The first run downloads about 106 MB of models/runtime; the large detector is cached locally. Slow devices may take longer and can cancel or retry.

The upload still saves the image to the owner's private project storage. Only inference is local; this is not an offline-only uploader. Recognition results are saved as owner-scoped PNG masks and candidates, restoring after refresh. Nothing is selected for paid processing automatically. Click candidates or use a description, check the masks, and correct categories or add a manual outline as needed. Cabinets are explicitly marked for checking whether they are built in.

Recognition is an estimate. Occlusion, small furniture, indistinct silhouettes and unusual furniture can produce missed objects or incomplete masks. The QA bedroom's small desk was classified as a low-confidence bench; the category correction control handles this. The model does not infer "by the window" reliably; the user must confirm the instance. No rectangle is substituted for a segmentation mask.

Background repair and the subsequent editable-furniture workflow still require a server-side `FAL_KEY`; those controls explain the missing service and do not submit paid tasks. World Labs and Tripo bindings are unchanged. Do not put service keys into chat, browser code, or tracked files.

Validation commands:

- `npm run typecheck`
- `node tests/recognition-smoke.mjs` — actual local inference on bedroom/living-room references, mask checks and reports in ignored `work/recognition/`.
- `TEST_BASE_URL=http://127.0.0.1:4173 node tests/recognition-api.mjs` — persistence, ownership, stale-photo guards, selection and missing-provider handling against a local production worker without provider credentials.
- `npm run build`

Bundled models are already included. `scripts/prepare-vision.py` and `scripts/prepare-sam.py` document preparation; normal installation/build does not fetch models. Browser worker failures and cancellation preserve the uploaded photo and provide retry/manual selection.
