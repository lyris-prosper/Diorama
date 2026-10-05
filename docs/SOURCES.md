# 官方来源与许可证

接口查阅日期：2026-10-03。适配代码依照当前 v3 文档，不沿用旧 Tripo v2 URL。

- World Labs 生成与草稿型号：<https://docs.worldlabs.ai/api/reference/worlds/generate>
- World Labs 计费与余额：<https://docs.worldlabs.ai/api/pricing>
- World Labs SPZ 比例、地面偏移、坐标转换：<https://docs.worldlabs.ai/api/rendering-spz>
- World Labs 官方示例：<https://github.com/worldlabsai/worldlabs-api-examples>
- Tripo v3 单图建模：<https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard>
- Tripo v3 图片上传：<https://developers.tripo3d.ai/en/docs/files>（JPEG/PNG，20MB 服务上限；应用限制 10MB）
- Tripo v3 账户：<https://developers.tripo3d.ai/en/docs/account>
- Tripo 费用：<https://developers.tripo3d.ai/en/pricing>（页面列出带标准纹理 Image→3D 基础 30 积分；应用保守预留 100，禁用昂贵附加项）
- SAM 3 托管端点与像素掩膜 schema：<https://fal.ai/models/fal-ai/sam-3/image/api>
- Bria Eraser 掩膜修复 schema：<https://fal.ai/models/fal-ai/bria/eraser/api>
- Spark（World Labs 维护，MIT，2.3.1，Three peer >=0.180）：<https://github.com/sparkjsdev/spark>
- Three.js（MIT）：<https://github.com/mrdoob/three.js>
- React（MIT）：<https://github.com/facebook/react>

`package-lock.json` 锁定实际依赖。Three.js 0.186.1 单份去重，与 Spark peer 范围相容。fal.ai SDK 1.10.1 仅在服务端导入。

托管 SAM 3 / Bria 的“Commercial use”标识不等于模型权重统一采用 MIT。没有下载其模型权重或以开源许可证重新分发；使用须遵循 fal.ai 与模型供应商条款。服务调用费用与账户权限独立于 Tripo/World Labs。

`resources/validation/` 是用户授权、使用提供的测试照片生成的真实验证资产，仅保存在本私有项目源仓库，未放入公开静态目录。示例床/书桌/柜子由本项目 Three.js 几何体创建，界面明确标为示例，不冒充生成结果。

## 2026-10-03 automatic local recognition

- Transformers.js 3.8.1: https://huggingface.co/docs/transformers.js/v3.8.1
- DETR panoptic ONNX export: https://huggingface.co/Xenova/detr-resnet-50-panoptic ; pinned revision in `public/vision/models/detr/weights.json`. Only its detection head is used; quantized panoptic masks were rejected during QA.
- Canonical COCO category names: https://github.com/cocodataset/panopticapi/blob/master/panoptic_coco_categories.json . Corrects unnamed cabinet/table merged classes in the upstream model config.
- SlimSAM: https://huggingface.co/Xenova/slimsam-77-uniform . Full precision encoder and decoder produce furniture pixel masks; pinned revision in `public/vision/models/slimsam/revision.json`.
- DETR, SlimSAM, Transformers.js: Apache-2.0. ONNX Runtime: MIT. Notices and licenses ship in `/vision/`.
- Empty-state room artwork: original image generated for this workbench. It is labeled conceptual inspiration and never used as a user's reconstruction.


## Local free background repair (2026-10-03)
- LaMa original: https://github.com/advimman/lama (Apache-2.0).
- Carve ONNX fp32 export: https://huggingface.co/Carve/LaMa-ONNX, revision `c3c0c9e468934d62e79c329e35d82dd09ff8c444`, Apache-2.0 model card.
- SHA256: `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`; 208044816 bytes; stored in ignored `.local/models/`.
- Native ONNX Runtime runs in a Node worker; 512 px aspect-preserving input and reflected padding. Only selected pixels are composited back at original resolution.

## 家具库（2026-10-05）

- 产品图：从用户提供的选品板（第 2 版，“官网原图：IKEA / MUJI / &Tradition / Marshall / iittala / KINTO / Vitra”）中逐张裁出，压成 400 px WebP，放在 `public/catalog/images/`。版权归各品牌所有，仅供本项目展示购买参考；公开发布前需确认使用权。
- 3D 模型：用户提供的 20 个 Tripo 导出 GLB（`../20款产品3D模型/`）。`scripts/build-catalog.mjs` 只做方向修正、按标称尺寸等比缩放、贴图降到 1024 px WebP、meshopt 压缩，不重新生成。160 MB → 6.2 MB。
- 价格与链接于 2026-10-05 查询。官网核实的人民币价：LISABO 书桌 ¥999、LISABO 椅 ¥399、IKORNNES ¥199、RUDSTA ¥599、DYTÅG ¥79.99（同系列灰绿色款价格）、SORTSÖ ¥49.99。其余标为“约”（`priceVerified: false`）：MUJI 中国官网不公开价格；&Tradition、Marshall、iittala、KINTO、Vitra 只查到海外官网价，人民币价为估算。MUJI 与两件 IKEA 链接是官方店铺的搜索页（`linkKind: "search"`），因为没有找到稳定的商品页。
- 工具：@gltf-transform 4.5（MIT）、meshoptimizer 1.3（MIT）、sharp（Apache-2.0）。浏览器端使用 three.js 自带的 `meshopt_decoder`。
