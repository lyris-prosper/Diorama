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
