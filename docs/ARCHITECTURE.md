# 架构与替换点

前端 React 19 / TypeScript，命令式 Three.js 0.186.1，Spark 2.3.1。选择 Three.js 直接管理一个 renderer，避免每张家具卡建立独立 WebGL 上下文；R3F/Drei 并非必需，未为技术名堆叠依赖。

后端 Cloudflare Worker：`/api/workbench` 处理项目、任务、上传和布局；`/api/assets` 基于项目所有者检查返回 R2 流。D1 使用预编译 SQL，迁移由 Drizzle 生成。

模型替换接口集中在 `lib/server/providers.ts`：

| 能力 | 选定实现 | 资源/凭据 | 已验证范围 |
|---|---|---|---|
| 意图 | 中英文类别规则；同类歧义人工确认 | 无模型、无 GPU | 空输入和未支持类别的后端门控 |
| 实例检测与分割 | fal.ai `fal-ai/sam-3/image` | `FAL_KEY`；GPU 由服务商管理 | 官方 schema 核对，未真实调用 |
| 手动修正 | 多边形→Canvas 像素掩膜 | 浏览器 Canvas | 实现，未浏览器验收 |
| 单件图 | 掩膜逐像素抠图→18% 留白→1024 PNG，另存原始裁切 | 浏览器内存 | 实现，未浏览器验收 |
| 背景修复 | fal.ai `fal-ai/bria/eraser` + 掩膜外原图回填 | `FAL_KEY` | 官方 schema 核对，未真实调用 |
| 空间 | World Labs `marble-1.0-draft` | `WORLDLABS_API_KEY` | 一张原图真实成功，230 积分 |
| 家具 | Tripo v3 `v3.1-20260211` | `TRIPO_API_KEY` | 余额查询成功；生成未实测 |
| 质检 | 分割置信度提示、空掩膜拒绝、未选像素差异、人工复核 | 浏览器/用户 | 未完成自动语义质检 |

不用模型仓库假冒在线 API，也不把 PyTorch / CUDA 安装进 128MB Worker。Grounding DINO / SAM 本地部署需要单独 GPU 服务，故本次选用托管 SAM 3。未来可替换 providers.ts，不应更改互斥分支语义和预算逻辑。

所有节点状态真实来自数据库或服务商，不使用假延时生成“结果”。查询每 5 秒触发一次，不显示虚构百分比。原图、原始裁切、掩膜、模型输入、修复结果、SPZ、碰撞网格、家具 GLB 各自独立存储。
