# 实测记录与未完成验收

日期：2026-10-03（Asia/Shanghai）。

## 已执行

- `npx tsc --noEmit`：通过。
- Sites 生产构建：通过。Spark 的 WASM/渲染代码构成较大动态 chunk；已有按需加载，不把体积警告当成功能失败。
- `node tests/api-smoke.mjs`：12 项通过。包括示例项目含 3 个对象、保存 transform、再次 GET 恢复、移除、保存后撤销恢复、跨用户项目拒绝、2.87MB 真实附件上传、A/B 在无 FAL_KEY 时阻止创建任务、空输入拒绝、未支持家具反馈、R2 资产所有权检查。
- 初次测试发现默认 1MB multipart 限制；已设置 12MB 框架上限并保留业务 10MB 限制，重启后附件上传通过。
- World Labs 初始余额 7000，Tripo 初始余额 25000、冻结 0。凭据查询成功，密钥未输出。
- World Labs 真正提交 1 个草稿任务：`336a35f4-8253-49de-b59f-75c4d064d23e`。
- 真实 world ID：`5fcf2cb9-3ad4-467c-b082-5f6319e56778`。
- 实际扣费 230：全景补全 80 + 草稿空间 150。余额 6770。
- 输出存在 `splats.spz_urls`、`mesh.collider_mesh_url`、全景与缩略图。HQ/可视网格为空，`semantics_metadata` 为空。
- 本次 Tripo 建模消耗：0。没有向缺凭据的 fal.ai 发起请求。

## 未通过/阻塞

| 验收 | 结论 |
|---|---|
| A 删除书桌、保留床柜、不调用 Tripo | 分支代码及凭据门控检查通过；实际分割/擦除/空间生成未完成，缺 FAL_KEY |
| B 床和桌独立提取、无背景残留、两个 GLB 可操作 | 代码已实现；实际链路未完成，缺 FAL_KEY；Tripo 未生成 |
| C 不处理家具直接生成空间 | 服务商原图→空间实测成功；网页到外部服务的完整链路未实测，预览 Worker 外网访问受限 |
| 上传空状态、分支、确认、处理中、侧栏及摆放截图 | 浏览器返回 ERR_BLOCKED_BY_CLIENT，未取得截图 |
| 实际鼠标拖放、× 阻止误触、撤销、相机与家具缩放 | 实现并完成类型检查，未通过浏览器交互验收 |
| 保存与刷新 | 后端保存后重新读取数据一致；浏览器刷新视觉恢复未验收 |
| 单件失败及重试 | 持久化状态机实现，未进行真实供应商失败注入 |
| 客户端无密钥 | 源码与最终客户端静态文件执行精确值扫描；密钥仅在忽略的开发文件及 Site secrets |
| M3 8GB 性能 | 未实机测量；已限制 splat 数量、DPR、帧率与上下文数量 |
| 真正 SPZ + Tripo GLB 同场景遮挡 | 未验证，不宣称通过 |

## 后续完成验收的最短步骤

1. 后端安全配置 FAL_KEY 并重新部署；确认 fal.ai 余额和权限。
2. 浏览器网络恢复后打开私有站，检查空状态与示例操作。用手动测试验证拖动取消、× 事件隔离、撤销、保存刷新。
3. 用附件执行 A，确认只勾书桌；检查处理后原图再付费生成。
4. 用附件执行 B，确认床和桌两个实例；仔细检查家具提取完整度、柜子保留与背景残影。失败返回重选，不自动重试付费生成。
5. 导入完成的房间后手动校准地面，逐件放置、旋转、缩放、收回；核对 splat 遮挡和比例。

以上未完成项是交付限制，不是已通过的测试。

## 2026-10-03 redesign and automatic recognition

- Warm architectural concept image integrated into the upload workspace; new sage/cream surfaces, larger readable controls, mobile layout, accessible workflow dialog, rounded 3D furniture edges and softer lighting.
- Actual inference tested with the shipped DETR + SlimSAM assets on the existing bedroom reference and a generated living-room reference. Bedroom: bed, cabinet, low-confidence bench (the small desk). Living room: sofa, chair, table. Masks visually inspected; they contain real foreground contours, not rectangular crops. Partial silhouettes and occlusion remain limitations and require checking before processing.
- Canonical COCO panoptic labels restored so cabinet/table classes do not appear as unknown labels. Quantized DETR mask output failed QA; only DETR class/box predictions are used, followed by full-precision SlimSAM masks.
- Test runtime uses the same recognition/postprocessing modules with ONNX CPU on this Mac; browser inference uses WASM in a worker. Native inference took approximately 7 seconds for the bedroom and 32 seconds for the living-room reference during the last run. This is not a browser speed guarantee.
- Recognition API test passed: upload actual masks, persist/reload candidates, select bed by description, reject empty/nonexistent selections, reject stale-photo results/foreign mask paths, preserve zero paid tasks and show the missing background-repair credential gate. The original 12 backend checks also passed.
- TypeScript checks and production build passed. Model weights and browser runtime are served by this site's own static assets.
- Browser automation was blocked by an unavailable administrator policy check, so screenshot, touch/drag and end-to-end browser inference QA remain unverified in this environment. No browser security workaround was used.
- No World Labs, Tripo or fal.ai generation requests were submitted by this update. Hosted background repair still requires `FAL_KEY`; this update deliberately does not present it as working.


## 2026-10-03 localhost correction — latest status

This section supersedes earlier FAL and browser-access blockers for the local image workflow. It does not claim paid 3D generation is free or tested.

- Started on http://localhost:5173, loopback only, with local SQLite/R2 emulation. No Site publication in this update.
- Actual browser upload automatically detected bed, cabinet and a low-confidence bench candidate (the desk). User can correct its category.
- Actual browser selection and LaMa repair completed; the bed disappeared and unselected cabinet/desk remained. Transparent bed PNG generated; verified 826393 transparent pixels in the 1024×1024 browser-produced cutout.
- Browser download of repaired room succeeded to the Downloads folder. Attachment responses now use Content-Disposition rather than relying on a temporary blob URL in localhost mode.
- `node tests/local-workflow.mjs` passed in 22.286 seconds: native recognition, manual mask flow, real LaMa inference, persistence, stale original rejection, cross-project background rejection, attachment download, transparent PNG, invalid mask rejection, cancellation and cross-origin rejection. Selected pixels changed on 84.37% of the mask; unselected pixel changes were exactly zero. No paid jobs created.
- Local background fill uses a pinned 512px LaMa model, preserves aspect ratio and blends only inside the mask at original photo size. Hidden content is inferred; large masks and edges still need visual review.
- Independent World Labs/Tripo 3D generation remains optional and requires local provider keys. No paid 3D calls made by this update.

## 2026-10-05 家具照片与尺寸、添加家具、家具库

本节只记录本次实际跑过的检查。没有提交任何 Tripo / World Labs 生成任务（实际扣费 0）。

- `npx tsc --noEmit`：通过。
- `node tests/provider-workflow.mjs`：13 项通过（共享家具词表迁移后无回归）。
- `node tests/furniture-workflow.mjs`（新）：7 项通过。真实路由处理函数 + 真实 SQLite，网络全部模拟。覆盖：`set-furniture-input` 拒绝别的空间/别的家具的照片、WebP、5–400 厘米以外的尺寸、非预览阶段；`generate` 用白底照片代替抠图并带上尺寸（曾故意改回抠图，测试确实失败）；`add-furniture` 拒绝超过 8 件、未确认积分、越权图片、空名称，整批超预算或余额不足时一个任务都不建，成功时每件预留 30 积分；示例房间不能生成；`add-catalog-item` 拒绝不存在的 id、没有房间的真实空间、无效落点，不发任何网络请求；保存后家具库字段与 9 厘米这类小高度都保留；60 件上限。
- `node tests/catalog-search.mjs`（新）：28 句通过，包括“我想要一张不超过 1 米的书桌”→ 说明没有 1 米以内的书桌、放宽尺寸后给出 LISABO（宽 118 厘米）。
- 新文件 ESLint 0 错误（只有与现有代码一致的 `<img>` 提示）；修改过的旧文件报错全部是本次之前就有的 `any`。
- 浏览器内实测（内置浏览器，1440×900 与 375×812）：
  - 示例房间：家具库面板滑出、聊天搜索、类别/宽度/价格筛选、“放进房间”后虚影跟随、点击落地；把蘑菇灯卡片直接拖到书桌上，离地 76 厘米（书桌 76.2 厘米）；检查器显示品牌、价格、去购买、真实尺寸；衣帽钩输入离地 150 厘米后沿墙拖动仍保持 150 厘米；保存后接口返回的位置、`catalogId`、高度正确。
  - 真实生成房间（复用已有房间的测试空间）：搜索“宽度不超过50厘米的床边桌”→ NESNA；放在床边，再把台灯放到它的玻璃台面上（离地 43 厘米）。
  - 预览与下载步骤：拖入 WebP 产品照后服务端存为 PNG，显示“白底，很适合生成”；尺寸三项填完才保存；“用回抠图”只清照片、保留尺寸；生成说明里写出 World Labs 约 230 + Tripo 30 × N。
  - 添加家具弹窗：一次拖入两张照片生成两行，名称取自文件名；高 3 厘米被标红并阻止提交；勾选积分确认前按钮不可用。点“取消”，没有提交，任务数 0。
  - 手机宽度：预览步骤与家具库底部抽屉没有横向滚动。
  - 实测中发现并修复：远处桌面因为背后地面点超出范围而放不上去；挂墙家具沿墙拖动时被判为越界而弹回；拖出房间时整次拖动被撤销（现在停在最后一个有效位置）；条件“宽 ≤100 cm”不在筛选按钮里时看不到；放置提示与提示条重叠。
- 未执行：`node tests/local-workflow.mjs`。本机可用内存约 1.4 GB，本地模型接口按设计拒绝（需要约 3 GB）。测试在第一步就停止，没有建项目。
- 未执行（需要付费确认）：用 Tripo 实际生成一件上传的家具并按尺寸摆进房间（预计 30 积分）。
- 测试留下的本地数据：一个示例空间和两个测试空间（`6afba5a5…` 复用房间，`47cfc43e…` 预览阶段）。测试结束后已把“我的空间”重新保存为最近打开的空间，内容未改。
