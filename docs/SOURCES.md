# 官方来源与许可证

## 服务商接口（查阅于 2026-10-03 / 10-04）

- World Labs 生成与草稿型号：<https://docs.worldlabs.ai/api/reference/worlds/generate>
- World Labs 计费与余额：<https://docs.worldlabs.ai/api/pricing>（照片草稿：全景补全 80 + 草稿空间 150 = 230 积分）
- World Labs SPZ 比例、地面偏移、坐标转换：<https://docs.worldlabs.ai/api/rendering-spz>
- World Labs 官方示例：<https://github.com/worldlabsai/worldlabs-api-examples>
- Tripo v3 单图建模：<https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard>
- Tripo v3 图片上传：<https://developers.tripo3d.ai/en/docs/files>（JPEG/PNG，20 MB 服务上限；应用限制 10 MB）
- Tripo v3 账户：<https://developers.tripo3d.ai/en/docs/account>
- Tripo 费用：<https://developers.tripo3d.ai/en/pricing>（标准贴图图生模型 30 积分；应用按 30 预留，不开 PBR 等附加项）

## 前端与运行库

- Spark（World Labs 维护，MIT，2.3.1）：<https://github.com/sparkjsdev/spark>
- Three.js（MIT）：<https://github.com/mrdoob/three.js>
- React（MIT）：<https://github.com/facebook/react>
- vinext、Vite（MIT）；Cloudflare workerd / Miniflare / wrangler（Apache-2.0 / MIT），只用于本地运行。

`package-lock.json` 锁定实际依赖版本。

## 本地识别与修复模型

- Transformers.js 3.8.1（Apache-2.0）：<https://huggingface.co/docs/transformers.js/v3.8.1>，在 Node 子进程里运行。
- DETR panoptic ONNX：<https://huggingface.co/Xenova/detr-resnet-50-panoptic>，固定版本见 `public/vision/models/detr/weights.json`。只用它的检测结果；量化后的全景掩膜在质检中被弃用。
- COCO 类别名：<https://github.com/cocodataset/panopticapi/blob/master/panoptic_coco_categories.json>，用来修正上游配置里柜子、桌子的类别名。
- SlimSAM：<https://huggingface.co/Xenova/slimsam-77-uniform>，全精度编码器和解码器生成家具像素轮廓；固定版本见 `public/vision/models/slimsam/revision.json`。
- LaMa：<https://github.com/advimman/lama>（Apache-2.0）。ONNX fp32 导出：<https://huggingface.co/Carve/LaMa-ONNX>，版本 `c3c0c9e468934d62e79c329e35d82dd09ff8c444`，SHA-256 `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`，208,044,816 字节，下载到不提交的 `.local/models/`。
- DETR、SlimSAM、Transformers.js 为 Apache-2.0，ONNX Runtime 为 MIT。许可证与说明随附在 `public/vision/`。

## 家具库（2026-10-05）

- **价格与链接**：来自用户提供的《温馨卧室第二版 20 款商品：官网链接与美元参考售价》（`20款家具_官网链接与美元售价_2026-10-05.json`，2026-10-05 核对）。
  - 每件都链接到品牌地区官网的商品页：IKEA 瑞典、新加坡、日本、英国站，MUJI 日本、美国、英国站，&Tradition 日本，Marshall 列支敦士登，Iittala 爱尔兰，KINTO 日本，Vitra 日本。
  - 价格用公开的单件标价。非美元标价按欧洲央行 2026-10-02 参考汇率换算：<https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html>。
  - 不含运费、关税和另售配件，不是中国到手价，也不是结算报价。20 件参考合计 $1,350.08。
  - 会员价（SORTSÖ 的 IKEA Family 价）单独记录，不作为主价格。缺货、仅门店有售、库存未核实的商品照常列出，并标明状态。
- **人民币换算**：“帮我找”遇到“500 元以内”这类说法时，用同一天的欧洲央行人民币汇率（1 EUR = 7.5259 CNY，即 1 CNY ≈ $0.1492）换成美元再筛选。页面上只显示美元。
- **产品图**：取自同一批官网产品图（`温馨卧室_20款官网产品图_第2版/images/`），用 `scripts/build-catalog.mjs --images` 裁成 512 px 方图（WebP），放在 `public/catalog/images/`。版权归各品牌所有，只作购买参考展示；公开发布前需确认使用权。
- **3D 模型**：用户提供的 20 个 Tripo 导出 GLB（`../20款产品3D模型/`）。`scripts/build-catalog.mjs` 只做方向修正、按标称尺寸等比缩放、贴图压到 1024 px WebP、meshopt 压缩，不重新生成。160 MB 压到 6.2 MB。
- **工具**：@gltf-transform 4.5（MIT）、meshoptimizer 1.3（MIT）、sharp（Apache-2.0）。浏览器端用 three.js 自带的 `meshopt_decoder` 解码。

## 演示卧室（2026-10-06）

- 房间：用户在 Marble 官网用 Marble 1.1 生成的世界 `dbf9b812-0db9-40c4-ae74-7fec6b05b600`（500k 与完整 `.spz`）。
- 空房间底图：Marble 世界 `3d1295b4-e546-42e0-8f51-b878ff47b05a`，由同一视角的无家具照片生成。
- 两者的 CDN 地址写在 `lib/demo-room.ts`，文件大小与本机副本逐字节一致（7,782,045 / 29,720,238 / 7,417,659 / 28,122,999 字节）。
- 床：用户的白底床照片（`resources/demo/bed.png`）经 Tripo v3.1 生成、本机压缩后的模型（`public/demo/bed.glb`，1,297,608 字节）。
- 演示照片 `resources/demo/bedroom.jpg` 是用户自己的卧室照片，只在私有仓库里保存。

## 字体

- Fraunces（SIL Open Font License 1.1）：<https://github.com/undercasetype/Fraunces>，英文标题。
- Figtree（SIL Open Font License 1.1）：<https://github.com/erikdkennedy/figtree>，英文正文。
- 通过 `@fontsource-variable/fraunces`、`@fontsource-variable/figtree` 随项目打包，离线可用。中文使用 macOS 自带的宋体和苹方。

## 测试与示例素材

- `resources/validation/thumbnail.webp`：用户提供的示例卧室照片的缩略图，用作识别测试的参考图。
- `resources/validation/living-room.webp`：为本工作台生成的客厅概念图，只用作识别测试的第二张参考图。
- 示例房间里的床、书桌、柜子是本项目用 Three.js 几何体搭的，界面上明确标为示例，不冒充生成结果。
