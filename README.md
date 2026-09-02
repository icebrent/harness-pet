# HarnessPet

HarnessPet 是一个 Windows 优先的轻量 Electron 桌宠。它使用透明、无边框、置顶窗口展示角色；用户点击角色或按 `Ctrl+Shift+Space` 唤出输入框，消息通过官方 DeepSeek Harness TypeScript SDK 发送给本机 Harness runtime，最终回答显示为角色头顶气泡。

当前版本实现桌宠与 Harness 连续对话的核心体验，并支持在运行中切换三套视觉角色；不包含数据库、账号、Web 服务或自建 Agent loop。

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

`pnpm dev` 会先重复执行素材处理脚本，再启动 Electron。点击角色可打开输入框；拖动角色可移动窗口；`Ctrl+Shift+Space` 可从任意位置唤出输入框。输入框中的角色选择器会立即切换视觉素材并记住选择，不会重启 Electron、Harness runtime 或 session。输入框中的 `New conversation` 才会生成新的 Harness session id；在此之前的连续提问复用同一个 session。

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

每个角色是一个独立的 character pack，原始九宫格固定放在 `assets/characters/<character-id>/source/poses.png`。九宫格状态顺序为：

```text
idle    happy   greet
think   walk-1  walk-2
back-1  back-2  sleep
```

```powershell
pnpm process:sprites
# 或只重建一个角色（共享画布仍按全部角色计算）
pnpm process:sprites --character claude-orange
```

处理流程：

1. 先在整张原图上提取 alpha 连通域，再按 3×3 中心把各连通域归属到九个状态；因此 `sleep` 等横向姿态即使跨越名义格线也不会被截断。
2. 按 alpha 通道计算每格完整包围盒，保留问号、感叹号、Zzz、翼和尾巴等内容。
3. 用每个角色 `idle` 中最大的 alpha 连通区域测量人物主体高度；以 `deepseek-blue` 为基准，为每个角色计算唯一 normalization scale，并对该角色九帧统一缩放。独立符号不参与身高测量。
4. 从人物主体的最低接地区域估算脚底中心 anchor；三套角色使用同一个透明 canvas 和 anchor，降低状态切换与角色切换时的位置跳动。
5. 为每个角色输出九张 PNG 和 `sprites/manifest.json`，其中记录 character id、source、canvas、anchor、状态文件和 normalization scale。

生成的 sprites 被 `.gitignore` 忽略，可随时从原图重建；原始 `poses.png` 不会被覆盖或重新生成。

### 加入新角色

1. 新建 `assets/characters/<stable-english-id>/source/poses.png`；仅在确有参考图时增加 `reference/`。
2. 在 `scripts/process-sprites.ts` 的角色清单中添加 id 和显示名。
3. 在 `src/renderer/character-registry.ts` 注册相同 id、显示名和 sprite 集合。
4. 在 `tests/sprites.test.ts` 增加该 id，然后运行 `pnpm process:sprites`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`。

Renderer 通过 Vite `import.meta.glob` 构建静态 Character Registry，不读取 Node `fs`，也不经过 `HarnessBridge`。选择结果只保存在 renderer 的 `localStorage`；保存的 id 失效时回退到 `deepseek-blue`。切换只替换当前 `SpriteName` 对应的图片，因此 `thinking`、`answer`、`sleep` 和走路帧都会原位延续。

## 目录结构

```text
assets/
  characters/
    deepseek-blue/
      source/poses.png
      reference/turnaround.png
      sprites/             可重复生成的九状态与 manifest
    claude-orange/
      source/poses.png
      reference/turnaround.png
      sprites/
    gpt-white/
      source/poses.png
      reference/turnaround.png
      sprites/
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
- Character 只是 visual skin；Harness session 保存 conversation state，persona 定义 agent behavior。三者当前完全解耦，切换角色不会创建新 session、改变 persona 或中断请求。
- 回答气泡提供 `Reply` 和 `Dismiss`；继续提问复用当前 Harness session。长回答在内缩区域滚动，阅读时暂停自动收起计时。
- 透明区域通过 Windows 的 `setIgnoreMouseEvents(..., { forward: true })` 和逐像素 alpha 命中动态穿透。输入框、气泡及角色实像区域保持可交互。
- 第一阶段面向开发运行；正式安装包需要另行确定 Harness runtime 的分发/发现策略。
