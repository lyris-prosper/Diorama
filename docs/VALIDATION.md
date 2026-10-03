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
