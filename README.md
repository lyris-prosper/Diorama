# 房间工作台 · localhost 版

当前默认在本机运行，不发布到 chatgpt.site。访问地址：<http://localhost:5173>。

## 启动

双击项目里的 **启动房间工作台.command**，或在项目目录执行：

```bash
npm start
```

需要 Node.js 22.13+。此电脑已安装依赖和模型。换电脑后先运行 `npm ci`。启动时自动检查本地模型、初始化数据库，监听 127.0.0.1:5173。首次安装 LaMa 需下载约 208 MB；之后识别与修复不需要联网。

## 完整的免费图片流程

1. 上传 PNG、JPG 或 WebP（不超过 10 MB）。本地 DETR + SlimSAM 自动检测家具并生成像素轮廓。
2. 点击家具或勾选候选，纠正误识别的类别。可以手动多边形圈选；圈选是人工指定范围，不伪装成自动识别。
3. 选择移除，或提取透明家具图。确认后本地 LaMa 补全被遮挡的墙面、地板。
4. 查看结果与原图对比，下载修复后的背景和透明 PNG；不满意可返回重新圈选。
5. 图片及轮廓持久保存在本机，刷新后恢复。识别和修复可以取消、重新执行，不消耗 API 积分。

背景补全只改变圈选掩膜内部的像素。单张照片无法提供家具背后的真实内容，补全属于推测，大面积遮挡、细腿、阴影和边缘仍需人工核对。低置信度类别不会当成确定结果；小桌可能被识别为凳子，可以修正。

## 可选的真实 3D 生成

图片处理完成即可下载使用，不必生成 3D。已有 Three.js 场景保留家具摆放、旋转、缩放、移除、撤销和保存。

真实房间重建用 World Labs，真实独立家具建模用 Tripo。这两项不是免费的本地修复功能，可能消耗服务商积分。若需要，在项目目录将 `.env.example` 复制为 `.dev.vars`，用本机编辑器填写 `WORLDLABS_API_KEY`、`TRIPO_API_KEY` 后重启。

**FAL_KEY 不再是本地识别、抠图和背景修复的前置条件。** 原先的 fal.ai / Bria 适配只作为旧版云服务代码保留。本次未调用 World Labs、Tripo 或 fal.ai 的付费生成。

## 家具：白底照片、添加新家具、家具库

- **预览与下载**这一步，每件要生成 3D 的家具都可以换成一张白底产品照，并填写宽 × 深 × 高（厘米）。生成时 Tripo 用这张照片代替房间抠图，模型按真实尺寸摆放。
- **家具栏 → 添加家具**：上传照片里没有的家具（一次最多 8 件，每件预计 30 Tripo 积分，提交前必须勾选确认）。
- **家具库**：20 件真实商品，带价格和购买链接，不花积分；可以用一句话找，例如“不超过 1 米的书桌”“500 元以内的灯”。家具可以叠放在别的家具上；壁挂家具用检查器里的“离地”挂到墙上。
- 维护家具库：编辑 `lib/catalog.json`，把源模型放在 `../20款产品3D模型/`（或 `--src` 指定），然后运行 `node scripts/build-catalog.mjs`。脚本只压缩本地模型，不调用付费服务；缺模型时会列出件数和预计积分后退出。

## 本机数据与资源

- `.wrangler/state/`：本地 SQLite 项目数据库及图片存储；勿删除，否则丢失本地项目。
- `.local/models/`：LaMa 模型与来源记录；不加入 Git。
- `public/vision/models/`：已随项目提供的识别模型。
- `scripts/local-vision-worker.mjs`：独立 Node worker 中的模型推理。
- `build/local-vision-plugin.mjs`：仅允许 loopback 的本地任务接口，含取消、超时、进度与跨来源请求拒绝。
- `启动房间工作台.command`：Mac 启动入口。关闭运行窗口即停止服务，数据保留。

本地数据与之前 chatgpt.site 上的数据互相独立；此更新不会自动删除旧站，也不会将本地照片上传到旧站。

## 验证

```bash
npm run typecheck
node tests/provider-workflow.mjs
node tests/furniture-workflow.mjs
node tests/catalog-search.mjs
node tests/local-workflow.mjs
```

后者需要本地工作台运行，会真实执行识别和 LaMa 推理，验证人工轮廓处理、保存恢复、未选像素零改动、透明 PNG、下载响应、取消与来源限制。测试新建本地测试项目，不调用付费服务。

来源：[LaMa](https://github.com/advimman/lama)、[Carve ONNX 导出](https://huggingface.co/Carve/LaMa-ONNX)、[SlimSAM](https://huggingface.co/Xenova/slimsam-77-uniform)。LaMa 下载已固定版本与 SHA-256，首次安装后从本机加载。
