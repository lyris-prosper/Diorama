# 官方来源与许可证

## 服务商接口（查阅于 2026-10-03 / 10-04）

- World Labs 生成与草稿型号：<https://docs.worldlabs.ai/api/reference/worlds/generate>
- World Labs 计费与余额：<https://docs.worldlabs.ai/api/pricing>（照片草稿：全景补全 80 + 草稿空间 150 = 230 积分）
- World Labs SPZ 比例、地面偏移、坐标转换：<https://docs.worldlabs.ai/api/rendering-spz>
- World Labs 官方示例：<https://github.com/worldlabsai/worldlabs-api-examples>
- Tripo v3 单图建模：<https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard>
- Tripo v3 图片上传：<https://developers.tripo3d.ai/en/docs/files>（JPEG/PNG，20 MB 服务上限；应用限制 10 MB）
- Tripo v3 账户：<https://developers.tripo3d.ai/en/docs/account>
- Tripo 费用：<https://developers.tripo3d.ai/en/pricing>、参数：<https://docs.tripo3d.ai/model-generation/image-to-model-v3-0-v3-1.html>（H3.1 图生模型：无贴图 20 积分，`texture_quality` 为 extreme（8K）再加 30，`geometry_quality` 为 detailed 再加 20，PBR 不另收费。应用按 70 预留，结束后以服务商返回的实际扣费为准）

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

## 家具库新增 10 件（2026-10-16）

给示例卧室补的大件，让“帮我布置”能把空房间布置完整。家具库共 30 件，参考合计 $2,212.90。

- **来源**：都来自 IKEA 瑞典官网（英文版）的商品页，2026-10-16 核对。商品图、标价、尺寸、货号都取自同一页面；库存取商品页结构化数据里的 InStock，不代表某个地址或门店能买到。
- **价格**：SEK 标价按上面同一个欧洲央行 2026-10-02 汇率换成美元（1 SEK ≈ $0.0994，四舍五入到分）。10 件合计 SEK 8,678，即 $862.82。
  - POÄNG 的 SEK 799 是官网公开的限时价（2026-09-01 至 10-30，不需要会员），平时 SEK 995，条目里写明。
  - 两盏灯都不含灯泡。

| 编号 | 条目 | 商品 | 标价 | 美元 | 尺寸（cm） |
|---|---|---|---|---|---|
| 21 | `telegraflinje-rug` | [TELEGRAFLINJE 平织地毯，黄米色](https://www.ikea.com/se/en/p/telegraflinje-rug-flatwoven-yellow-beige-50555281/) | SEK 995 | $98.93 | 170 × 240 |
| 22 | `fejka-plant` | [FEJKA 仿真盆栽，天堂鸟](https://www.ikea.com/se/en/p/fejka-artificial-potted-plant-in-outdoor-bird-of-paradise-70610601/) | SEK 799 | $79.44 | 盆径 23 × 高 180 |
| 23 | `lauters-floor-lamp` | [LAUTERS 落地灯，白蜡木/白色](https://www.ikea.com/se/en/p/lauters-floor-lamp-ash-white-30405042/) | SEK 599 | $59.56 | 底座直径 62 × 高 119–151 |
| 24 | `poang-armchair` | [POÄNG 扶手椅，桦木贴面/Knisa 浅米色](https://www.ikea.com/se/en/p/poaeng-armchair-birch-veneer-knisa-light-beige-s39240787/) | SEK 799 | $79.44 | 68 × 82 × 100 |
| 25 | `tolkning-bench` | [TOLKNING 收纳长凳，手工藤编](https://www.ikea.com/se/en/p/tolkning-bench-with-storage-handmade-rattan-80512657/) | SEK 1,995 | $198.35 | 120 × 37 × 46 |
| 26 | `giverny-picture` | [BLODFLÄDER 装饰画，莫奈《吉维尼的塞纳河》](https://www.ikea.com/se/en/p/blodflaeder-picture-the-seine-at-giverny-20601915/) | SEK 699 | $69.50 | 120 × 80 × 3（含框） |
| 27 | `orange-flower-picture` | [BLODFLÄDER 装饰画，橙花](https://www.ikea.com/se/en/p/blodflaeder-picture-orange-flower-40601919/) | SEK 299 | $29.73 | 42 × 52 × 3（含框） |
| 28 | `blidvader-lamp` | [BLIDVÄDER 台灯，米白陶瓷/米色](https://www.ikea.com/se/en/p/blidvaeder-table-lamp-off-white-ceramic-beige-80501258/) | SEK 699 | $69.50 | 灯罩直径 30 × 高 50 |
| 29 | `ikornnes-standing-mirror` | [IKORNNES 落地镜，白蜡木](https://www.ikea.com/se/en/p/ikornnes-standing-mirror-ash-30298396/) | SEK 995 | $98.93 | 52 × 52 × 167 |
| 30 | `billy-bookcase` | [BILLY 书架，橡木纹](https://www.ikea.com/se/en/p/billy-bookcase-oak-effect-10508932/) | SEK 799 | $79.44 | 80 × 28 × 202 |

- **产品图**：`../新增家具官网商品图/images/`，编号 21–30，接在原来 20 张后面，用 `scripts/build-catalog.mjs --images` 生成卡片图（原 20 张的输出逐字节不变）。BILLY 的官网主图是灰色墙面背景，把与图片边缘相连的浅灰背景换成了白色；原图另存为同目录下的“BILLY 官网原图（灰背景）.jpg”。版权归 IKEA 所有，只作购买参考展示。
- **3D 模型**：源文件在 `../新增家具3D模型/`，`scripts/build-catalog.mjs --src ../新增家具3D模型` 压缩后放进 `public/catalog/models/`（10 件共 6.5 MB，单件 0.25–1.45 MB；原 20 件共 6.6 MB）。
  - 8 件由 `scripts/tripo-catalog.mjs` 用应用里同样的 Tripo 设置生成（`TRIPO_SETTINGS`：H3.1、精细几何、8K PBR），每件 66–94 MB；任务编号记在同目录的 `tripo-tasks.json`。藤编凳和橙花挂画的官网图（渐进式 JPEG）头几次也被拒收，重新编码成普通 JPEG 后生成成功。
  - 地毯：Tripo 连续拒收这张俯拍图（“input image is not accessible”，没有建任务，也没有扣费），改为直接用官网俯视图做成薄片：顶面就是照片，白底抠空、保留流苏，下面垫 5 mm 厚的边。
  - 莫奈挂画：Tripo 把这幅平面画生成成了带浮雕的箱子，不能用（这次生成的 70 积分照扣）。改用官网正面图做成 3 cm 厚的画框板，照片裁到画框，侧面和背面取画框颜色。官网图的长宽比和标称尺寸一致（1.494 对 1.5）。
  - 这两件的生成脚本（`rug-glb.mjs`、`picture-glb.mjs`）和源文件放在一起；Tripo 生成的挂画原件也保留在那里，没有使用。
  - 照片比例和标称尺寸不完全一致的几件（地毯、莫奈挂画、落地镜、书架）在 `source.fit` 里标了 `stretch`，按三轴分别缩放到标称尺寸；其余等比缩放。绿植的标称尺寸只有盆径和高度，`dims` 的宽和深按模型的叶展（105 × 82 cm）填写。
  - 朝向、尺寸和贴图逐件在 three.js 里看过：都正面朝前（+Z），贴图颜色和官网图一致。书架右下角有一小块灰色残片（来自官网图的墙面阴影）。
- **Tripo 花费**：生成前余额 24,740，生成后 24,110，共扣 630 积分（9 个任务，每个 70，含没有使用的莫奈挂画）。被拒收的提交和一次网络中断都没有建任务，也没有扣费（中断那次用余额和冻结额核对过）。

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

## 演示素材（`resources/demo/`、`public/demo/`）

- `bedroom.jpg`、`bed.png`：用户自己的卧室照片和床的照片。
- `pendant.png`：用户找来的第三方吊灯商品图（Wide Pendant），只用于本地演示；公开发布前需要确认使用权。
- `public/demo/bed.glb`、`public/demo/pendant.glb`：用上面两张照片经 Tripo 生成的模型（吊灯为 H3.1 高精度、8K 贴图原件的 4K 副本）。
