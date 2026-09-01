# HarnessPet

HarnessPet 是一个 Windows 优先的轻量 Electron 桌宠。它使用透明、无边框、置顶窗口展示角色；用户点击角色或按 `Ctrl+Shift+Space` 唤出输入框，消息通过官方 DeepSeek Harness TypeScript SDK 发送给本机 Harness runtime，最终回答显示为角色头顶气泡。

第一版只实现桌宠与 Harness 连续对话的核心体验，不包含数据库、账号、Web 服务或自建 Agent loop。

## 环境依赖

- Windows 10/11
- Node.js `>=22.19.0`
- pnpm 11
- 本机 Harness 源码位于同级目录 `../deepseek-harness`
- Harness 已按官方方式配置 provider credential；应用继承当前进程环境与默认 `~/.dsh` 配置，不保存或渲染 secret

当前项目通过只读 `link:../deepseek-harness/packages/sdk/client` 使用本机 `@deepseek-ai/dsh-sdk-client`。一个由 Electron main 管理的极薄 plain-Node worker 持有 SDK；SDK 自行启动 `dsh --profile sdk` 子进程并通过 stdio JSON-RPC 通信。main 与 worker 之间只传 prompt、session id 和 final response，Renderer 仍只接触安全 IPC。开发或测试 HarnessPet 不会修改 Harness 仓库。

Harness runtime 与 SDK 会话固定使用独立工作区 `D:\deepseek\harness-pet-workspace`，应用启动和 `harness:smoke` 检查会在目录不存在时自动创建它。worker 进程目录与 SDK 初始化的 `cwd` 使用同一路径，避免日常桌宠对话把 HarnessPet 源码目录当作工作区。

HarnessPet 通过 SDK 官方 `patches` 参数加载 `config/harness-pet.cordis.yml`，在保留 `sdk` profile、JSON-RPC server 与原有 coding-agent 身份的基础上追加桌宠 persona。该 patch 只由 HarnessPet runtime 加载，不修改 Harness 仓库，也不影响 Web UI agent presets；persona 修改需要重启应用后生效。

本机源码 runtime 在 Windows 冷启动时可能超过 SDK 默认的 10 秒 initialize 上限，因此 HarnessPet 将 initialize 上限设为 60 秒；该设置不改变单轮模型执行语义。

Electron main 中的 `process.execPath` 指向 `electron.exe`，而当前 SDK 用 `process.execPath` 生成 runtime launch spec。为避免 Electron 可执行文件与 plain Node 的启动语义差异，`HarnessBridge` 使用系统 Node 启动上述本地 worker；credential 和 `~/.dsh` 仍由官方 SDK/官方机制读取，Renderer 无法访问这些环境变量。

## 开发启动

```powershell
pnpm install
pnpm dev
```

`pnpm dev` 会先重复执行素材处理脚本，再启动 Electron。点击角色可打开输入框；拖动角色可移动窗口；`Ctrl+Shift+Space` 可从任意位置唤出输入框。输入框中的“新对话”会生成新的 Harness session id；在此之前的连续提问复用同一个 session。

## 检查与验证

```powershell
pnpm process:sprites
pnpm typecheck
pnpm test
pnpm build
pnpm harness:smoke
```

`harness:smoke` 会真实启动本机 Harness runtime，连续发送两次最小请求，并检查两次调用是否复用 session。它可能产生正常的 Harness 本地 session 记录，但不会读取或打印 credential。

## 素材处理

原始九宫格放在 `assets/source/`。脚本优先读取 `deepseek-girl-poses.png`；若目录内只有一个 PNG，也会自动使用该文件，因此当前附件原名无需更改。

```powershell
pnpm process:sprites
# 或显式指定
pnpm exec tsx scripts/process-sprites.ts --input assets/source/deepseek-girl-poses.png
```

处理流程：

1. 按精确 3×3 边界切分，即使原图尺寸不能被 3 整除也不会丢行列。
2. 按 alpha 通道计算每格完整包围盒，保留问号、Zzz 等附属图形。
3. 从人物最低接地区域估算脚底中心 anchor。
4. 计算所有状态共同所需的透明 canvas，并将每张图对齐到相同 anchor。
5. 输出九张 PNG 和 `assets/sprites/manifest.json`。

生成的 sprites 被 `.gitignore` 忽略，可随时从原图重建；原始素材不会被覆盖。

## 目录结构

```text
assets/
  source/        原始九宫格（只读输入）
  reference/     视觉参考（运行时不使用）
  sprites/       可重复生成的统一画布 sprites
scripts/
  process-sprites.ts
  harness-smoke.ts
config/
  harness-pet.cordis.yml  HarnessPet 专属 SDK profile patch 与 persona
src/
  main/          Electron main、HarnessBridge 与 plain-Node SDK worker
  preload/       contextBridge 安全 IPC
  renderer/      桌宠、气泡、输入框与动画
  shared/        IPC 数据契约
tests/
```

## 当前边界

- Harness 状态只映射为 `idle / thinking / answer / error`；不解析复杂 reasoning 或 tool 内部事件。
- SDK 使用随附的 `sdk` profile，并通过项目内 patch 追加 HarnessPet 专属 persona。
- 回答时使用 `happy`，平时使用 `idle`；`greet` 只保留为独立素材，不伪装 talk 动画。
- 回答气泡提供“继续提问”和“收起”；继续提问复用当前 Harness session。长回答在内缩区域滚动，阅读时暂停自动收起计时。
- 透明区域通过 Windows 的 `setIgnoreMouseEvents(..., { forward: true })` 和逐像素 alpha 命中动态穿透。输入框、气泡及角色实像区域保持可交互。
- 第一阶段面向开发运行；正式安装包需要另行确定 Harness runtime 的分发/发现策略。
