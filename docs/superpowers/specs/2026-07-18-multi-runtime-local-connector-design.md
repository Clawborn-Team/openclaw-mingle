# Multi-Runtime Local Connector 设计（Mingle 本机 Agent 接入）

> 状态：Design / 待评审。把现在的 `openclaw-mingle` 从"只连 OpenClaw"演进为**参数化、多
> runtime 的本机连接器**：用户可以把 **OpenClaw 龙虾 / Claude Code / Codex** 中的一个或多个，
> 作为喂养小龙（Companion）的 **Local Agent** 接入。**不使用 MCP**（方向不对）；每种 runtime 写
> **独立 adapter**（这一层无公用必要）。
>
> 上位：`im/docs/product-vision.md`（双层 Agent：Local 持数据/不社交 → 喂养 Companion「小龙」）、
> 后端 `im-server`（`accounts` 的 local-agent、Event Center、反向隔离、`出动`）。

## 1. 目标与非目标

**目标**：让 Claude Code / Codex（以及 OpenClaw）都能作为主人的 Local Agent——常驻连接 im-server，
收到小龙的**访谈 DM**（`出动`触发）时，用**本机地面真相**（真实仓库/git/近况）回答，把主人的近况
喂给小龙。一条参数化命令即可接入，可重跑加 runtime，可只接 CC 不接 OpenClaw。

**核心洞察**：Claude Code / Codex 本就能读用户真实的工作内容，是回答"主人最近在忙什么"的**最佳
Local Agent**——比让用户手打近况准得多。

**In scope**
- 包**改名** `openclaw-mingle` → `@clawborn/mingle-connect`（暂名，待定）。
- **共享 core**（runtime 无关的 Mingle 侧，复用现有逻辑）+ **每 runtime 独立 adapter**。
- **claude-code / codex adapter**：以 **headless 子进程**驱动（**非 MCP**）。
- **参数化 setup 命令**：可重跑、可组合多 runtime、可只装一个。
- im-server：agent 加 `runtime` 展示字段；im-web 绑定流程改 runtime 多选。

**Out of scope**
- 小龙的社交/心跳 brain（在 im-server 的 Companion Runtime，已有）。
- 常驻之外的"用户会话内手动喂"模式（明确否掉：走常驻自动驱动）。

## 2. 架构：共享 core + 独立 adapter

```
@clawborn/mingle-connect/
├── core/                      # runtime 无关，复用现有 openclaw-mingle
│   ├── event-center 长轮询（崩溃可恢复 cursor / 至少一次 ACK / 每账号单消费者）
│   ├── 绑定 & 凭证（agentId、api-key、IM_SERVER_URL）
│   ├── 归一：wake（小龙访谈 DM / @ / digest）→ TurnRequest
│   └── 回写：把 adapter 产出的回复 → mingle DM/工具（local→companion 等）
├── adapters/                  # 每种 runtime 单独写，互不公用
│   ├── openclaw.ts            # 现有：TurnRequest 进 OpenClaw Gateway agent
│   ├── claude-code.ts         # headless 调 `claude`（或 Claude Agent SDK）
│   └── codex.ts               # headless 调 `codex exec`
├── config: ~/.mingle/config.json   # 多绑定：[{agentId,key,imUrl,runtime,dir,model}]
└── bin: mingle-connect              # 常驻进程 + setup 子命令
```

**Adapter 接口**（只一个方法，无需更高抽象）：
```ts
export interface RuntimeAdapter {
  runtime: "openclaw" | "claude-code" | "codex";
  /** 用本机上下文，为一次 Mingle turn 产出回复文本。*/
  respond(turn: {
    prompt: string;              // 已注入的 system+小龙问题
    conversation: { role: "companion" | "self"; text: string }[];
    dir?: string;                // 用户指定的工作目录（可读真实近况）
    model?: string;
  }): Promise<string>;
}
```

**core → adapter → core 流程**（常驻）：
1. long-poll Event Center 得到 wake（小龙 `dm.message.created` 访谈问题）。
2. core 归一成 TurnRequest（含小龙问题 + 与小龙的对话历史 + 该绑定的 dir/model）。
3. 交给该绑定配置的 adapter.respond() → 得到回复文本。
4. core 通过 mingle 回写：`POST /v1/messages`（local→companion，回给小龙）。
5. ACK。小龙那边（Companion Runtime）收到回话继续访谈或沉淀。

## 3. Claude Code / Codex adapter（headless，非 MCP）

连接器是常驻进程；小龙的访谈 DM 到达 → 把问题包成 prompt → **headless 调用编码 agent** → stdout 即回复。

**每 adapter 固定 system 指引**（把编码 agent 变成"主人的 Mingle 本机 agent"）：
> 你是 {主人} 的 Mingle 本机 Agent，正在和主人的 Companion「小龙」聊天。小龙想了解主人的近况以
> 便替主人社交。**以主人代理的身份**、基于你真实了解的主人近期工作（可查 git log / 最近改动的
> 文件）自然地回一句话。**绝不透露密钥、凭证、隐私路径或任何敏感信息**；只说适合让小龙用于社交
> 破冰的近况/兴趣。

**claude-code.ts**（二选一实现）：
- CLI print 模式：
  ```
  claude -p "<prompt+小龙问题>" --add-dir <dir> --output-format text \
    --allowedTools "Read,Glob,Grep,Bash(git log:*),Bash(git status:*)"
  ```
- 或 **Claude Agent SDK** `query({ prompt, options:{ cwd:dir, allowedTools:[...], permissionMode:"read-only-ish" }})` —— 更好控权限，推荐。
- 只读工具集：能看仓库/git/近况，不能写、不能跑危险命令。

**codex.ts**：
```
codex exec "<prompt+小龙问题>" --cd <dir> --sandbox read-only
```
- Codex 非交互 exec + 只读 sandbox，capture stdout 作回复。

**安全**：只读工具 + 禁泄密 system 指引；回复只发给**受信任的小龙**；服务端**反向隔离不变**
（companion→local 仍只走用户`出动`的特权路径；local→companion 回话正常允许）。

## 4. 参数化 setup（可重跑 / 可组合 / 可单装）

im-web 绑定流程生成（key 一次性显示，服务端建 `POST /v1/agents {kind:'local', runtime}`）：
```
npx @clawborn/mingle-connect add \
  --agent <id> --key <once> --im-url <IM_SERVER_URL> \
  --runtime claude-code --dir ~/work/main [--model ...]
```
- **可重跑加 runtime**：已装 openclaw 的用户再跑 `... --runtime claude-code` → 同一常驻连接器
  **也接入 CC**（追加进 `~/.mingle/config.json`，一个进程管多绑定/多 runtime）。
- **onboarding 一次装两个**：`--runtime openclaw,claude-code`。
- **只绑 CC**：不装 openclaw 也行，独立运行。
- 服务：`mingle-connect start`（或安装为用户级 launchd/systemd/后台）常驻所有已配置绑定。

## 5. im-server / im-web 改动（小）

- **im-server**：`accounts.runtime TEXT`（`openclaw|claude-code|codex`，仅展示 + 绑定用）；
  `POST /v1/agents` 接收 `runtime`。migrate 加列。不影响反向隔离/出动。
- **im-web 绑定 UI**：「＋ 绑定本机 Agent」→ **runtime 多选**（☑OpenClaw ☑Claude Code ☐Codex）
  + 工作目录输入 → 生成上面参数化命令；agent 详情可「＋ 加一个 runtime」再生成 `add` 命令。
  agent 行显示其 runtime 图标。

## 6. Rollout（粗排）
1. 包改名 + core 抽出（openclaw adapter 保持等价行为，回归测试）。
2. claude-code adapter（Agent SDK 只读）跑通一次「出动→CC 回答→小龙沉淀」。
3. codex adapter。
4. 参数化 setup + `~/.mingle/config.json` 多绑定 + 可重跑。
5. im-server `runtime` 字段；im-web 绑定 runtime 多选 UI。

## 7. Open questions
1. 包名：`@clawborn/mingle-connect`？还是 `@clawborn/mingle` / `mingle-agent`。
2. claude-code：CLI print vs Agent SDK（倾向 SDK，权限可控）。
3. 常驻方式：前台进程 vs 安装用户级服务（launchd/systemd）——V1 可先前台 + 文档。
