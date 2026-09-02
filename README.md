# HarnessPet

HarnessPet 是一个 Windows 优先的轻量 Electron 桌宠。它使用透明、无边框、置顶窗口展示角色；用户点击角色或按 `Ctrl+Shift+Space` 唤出输入框，消息通过官方 DeepSeek Harness TypeScript SDK 发送给本机 Harness runtime，最终回答显示为角色头顶气泡。

当前版本实现桌宠与 Harness 连续对话的核心体验，并提供两种启动时确定的显示模式；不包含数据库、账号、Web 服务或自建 Agent loop。

- **Chibi mode**：默认模式。使用三套 Q 版角色，可运行中切换角色、随机在桌面横向走动并进入 sleep。
- **Kanban mode**：使用 `--mode=kanban` 启动，当前固定为正常人体比例的 `qwen-purple` 看板娘，不随机移动，通过六张静态表情差分响应 Harness 状态。

Kanban mode 不是 Live2D：它没有骨骼、模型或连续嘴型动画，只使用保持相同构图和对齐的静态立绘切换表情。两种模式复用同一套 Harness runtime、安全 IPC、session、气泡、输入框、拖动与透明区域鼠标穿透机制。

## 环境依赖

- Windows 10/11
- Node.js `>=22.19.0`
- pnpm 11
- 本机 Harness 源码位于同级目录 `../deepseek-harness`
- Harness 已按官方方式配置 provider credential；应用继承当前进程环境与默认 `~/.dsh` 配置，不保存或渲染 secret

当前项目通过只读 `link:../deepseek-harness/packages/sdk/client` 使用本机 `@deepseek-ai/dsh-sdk-client`。一个由 Electron main 管理的极薄 plain-Node worker 持有 SDK；SDK 自行启动 `dsh --profile sdk` 子进程并通过 stdio JSON-RPC 通信。main 与 worker 之间只传 prompt、session id 和 final response，Renderer 仍只接触安全 IPC。开发或测试 HarnessPet 不会修改 Harness 仓库。

Harness runtime 与 SDK 会话固定使用独立工作区 `D:\deepseek\harness-pet-workspace`，应用启动和 `harness:smoke` 检查会在目录不存在时自动创建它。worker 进程目录与 SDK 初始化的 `cwd` 使用同一路径，避免日常桌宠对话把 HarnessPet 源码目录当作工作区。

HarnessPet 通过 SDK 官方 `patches` 参数加载 `config/harness-pet.cordis.yml`，在保留 `sdk` profile、JSON-RPC server 与原有 coding-agent 身份的基础上追加中性的 HarnessPet base persona。该 patch 只由 HarnessPet runtime 加载，不修改 Harness 仓库，也不影响 Web UI agent presets；base persona 修改需要重启应用后生效。具体 character persona 集中定义在 `src/shared/characters.ts`，由每个新 session 的第一条真实用户消息一次性引导，不会单独调用模型或每轮重复注入。

本机源码 runtime 在 Windows 冷启动时可能超过 SDK 默认的 10 秒 initialize 上限，因此 HarnessPet 将 initialize 上限设为 60 秒；该设置不改变单轮模型执行语义。

Electron main 中的 `process.execPath` 指向 `electron.exe`，而当前 SDK 用 `process.execPath` 生成 runtime launch spec。为避免 Electron 可执行文件与 plain Node 的启动语义差异，`HarnessBridge` 使用系统 Node 启动上述本地 worker；credential 和 `~/.dsh` 仍由官方 SDK/官方机制读取，Renderer 无法访问这些环境变量。

## 开发启动

```powershell
pnpm install
pnpm dev
```

默认启动 Chibi mode：

```powershell
pnpm dev
# 等价于
pnpm dev -- --mode=chibi
```

启动 Kanban mode：

```powershell
pnpm dev -- --mode=kanban
```

打包后的 Electron executable 使用相同参数语义：

```powershell
HarnessPet.exe --mode=kanban
```

未知或非法 `--mode` 会输出一条简短 warning 并安全回退到 `chibi`。mode 只在 Electron main 启动时解析，运行过程中不切换。

`pnpm dev` 会先重复执行素材处理脚本，再启动 Electron。点击角色可打开输入框；拖动角色可移动窗口；`Ctrl+Shift+Space` 可从任意位置唤出输入框。Chibi mode 的角色选择器会立即切换视觉素材、记住选择并创建新的 Harness session，但不会重启 Electron 或 Harness runtime；未发送的输入内容会保留。Kanban mode 隐藏角色选择器并固定使用 `qwen-purple`。请求运行期间角色选择器和新对话按钮会暂时禁用。`New conversation` 保持当前角色不变并生成新的 session id。两种新 session 都会在下一条真实用户消息中重新引导当前角色 persona，之后的连续提问只发送原始用户输入。

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

### Kanban 表情素材

`qwen-purple` 不使用上述 Chibi 九宫格。原始差分位于 `assets/characters/qwen-purple/source/expressions.png`，是 3×2、每格 512×512 的透明 sheet，按行映射为：

```text
idle   happy   think
talk   error   rest
```

处理脚本保持每格缩放为 `1`，按人物主连通域的脚底中心将整格平移到共享 anchor，输出到 `assets/characters/qwen-purple/sprites/`。这样不会对各状态单独缩放，也不会修改 `source/original.png` 或 `source/expressions.png`。当前状态映射为 `idle → idle`、`thinking → think`、`answer → talk`、`error → error`；长时间无操作时可短暂显示 `rest`。Kanban mode 不使用 walk、back 或 Chibi sleep。

### 加入新角色

1. 新建 `assets/characters/<stable-english-id>/source/poses.png`；仅在确有参考图时增加 `reference/`。
2. 在 `scripts/process-sprites.ts` 的角色清单中添加 id 和显示名。
3. 在 `src/shared/characters.ts` 注册相同 id、显示名和 persona；renderer registry 会据此装配对应 sprite 集合。
4. 在 `tests/sprites.test.ts` 增加该 id，然后运行 `pnpm process:sprites`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`。

Renderer 通过 Vite `import.meta.glob` 构建静态 sprite registry，不读取 Node `fs`。共享层只提供 character id、显示名与 persona，不包含 Electron/Node 依赖或视觉资源。选择结果保存在 renderer 的 `localStorage`，启动时通过安全 IPC 同步给 `HarnessBridge`；保存的 id 失效时两侧都回退到 `deepseek-blue`。切换只替换当前 `SpriteName` 对应的图片，因此视觉状态原位延续，同时 `HarnessBridge` 创建全新 session 并重置 persona bootstrap。

## 角色素材署名

本项目角色视觉素材的相关画师如下。角色形象及原始美术素材的著作权与其他相关权利归原画师或相应权利人所有：

- [ZipZipPipe](https://space.bilibili.com/4168597)
- [这个刀子真甜](https://space.bilibili.com/23315338)

仓库当前未记录两位画师与各 character pack 的逐一对应关系，因此此处仅列出已知画师署名，不对具体角色归属作未经确认的推断。

## 使用范围与免责声明

- 本项目仅供个人学习、研究、技术交流和非商业用途使用，不得用于商业销售、付费服务、广告营销、商业宣传或其他营利活动。
- 项目代码与角色视觉素材是不同的权利对象。除非相应权利人另有明确授权，本仓库的公开可访问性不代表角色形象、美术素材、名称或其他第三方内容已被授予复制、修改、再发布、再许可、售卖、商品化或用于模型训练的权利。
- 请勿单独提取、重新打包、转载或分发仓库中的角色原图、参考图、sprite 或其衍生素材。任何超出个人非商业使用范围的用途，均应事先取得相应画师及其他权利人的明确许可。
- `DeepSeek`、`Claude`、`GPT` 及相关名称、商标和产品归各自权利人所有。本项目中的角色名称仅用于区分 HarnessPet 角色形象，不代表相关公司对本项目的授权、认可、赞助或合作，也不表示角色实际连接对应公司的模型或服务。
- 本项目依赖 DeepSeek Harness、相关 SDK、模型 provider 及其他第三方软件或服务。使用者应自行遵守各第三方的许可证、服务条款、隐私政策、费用规则和所在地适用法律法规。
- AI 输出可能包含错误、不完整或不适当的信息，不构成医疗、法律、财务或其他专业建议。使用者应自行核验输出并对使用结果、工具调用以及由此产生的数据、费用或损失负责。
- 本项目按“现状”提供，不对适销性、特定用途适用性、准确性、稳定性、持续可用性或不侵权作任何明示或默示保证。在适用法律允许的最大范围内，项目维护者与代码贡献者不对因使用或无法使用本项目产生的直接或间接损失承担责任。本说明不构成法律意见。
- 如你是相关权利人，认为仓库中的署名、素材或使用方式需要更正或移除，请通过本仓库的 Issue 或维护者公开联系方式提出；维护者会在核实后及时处理。

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
    qwen-purple/
      source/original.png
      source/expressions.png
      sprites/             六张静态 Kanban 表情与 manifest
scripts/
  process-sprites.ts
  harness-smoke.ts
config/
  harness-pet.cordis.yml  HarnessPet 专属 SDK profile patch 与 persona
src/
  main/          Electron main、HarnessBridge 与 plain-Node SDK worker
  preload/       contextBridge 安全 IPC
  renderer/      桌宠、气泡、输入框与动画
  shared/        IPC 数据契约与集中 character metadata/persona
tests/
```

## 当前边界

- Harness 状态只映射为 `idle / thinking / answer / error`；不解析复杂 reasoning 或 tool 内部事件。
- SDK 使用随附的 `sdk` profile，并通过项目内 patch 追加中性 HarnessPet base persona；角色切换不会重载 profile、patch 或 credential。
- 回答时使用 `happy`，平时使用 `idle`；`greet` 只保留为独立素材，不伪装 talk 动画。
- Character 同时提供 visual skin 和轻量 conversational persona。`HarnessBridge` 保存当前 character、session id 与 bootstrap 状态；换角色会换 skin 并创建新 session，手动新对话则保持角色。两者都不重建单例 Harness runtime，也不会中断正在运行的请求。
- 回答气泡提供 `Reply` 和 `Dismiss`；继续提问复用当前 Harness session。长回答在内缩区域滚动，阅读时暂停自动收起计时。
- 透明区域通过 Windows 的 `setIgnoreMouseEvents(..., { forward: true })` 和逐像素 alpha 命中动态穿透。输入框、气泡及角色实像区域保持可交互。
- 第一阶段面向开发运行；正式安装包需要另行确定 Harness runtime 的分发/发现策略。
