# dsh-api3d

[![npm](https://img.shields.io/npm/v/dsh-api3d?label=npm)](https://www.npmjs.com/package/dsh-api3d)
[![license](https://img.shields.io/github/license/ptb-xiaou/dsh-api3d)](https://github.com/ptb-xiaou/dsh-api3d/blob/main/LICENSE)

**中文** · [English](README.en.md)

> 📦 开源仓库：[ptb-xiaou/dsh-api3d](https://github.com/ptb-xiaou/dsh-api3d) ｜ npm：[dsh-api3d@0.2.6](https://www.npmjs.com/package/dsh-api3d) ｜ [Release v0.2.6](https://github.com/ptb-xiaou/dsh-api3d/releases/tag/v0.2.6) ｜ MIT（衍生说明见 [NOTICE](NOTICE)）

把 **API3D（[api3d.cn](https://api3d.cn)）** 这条中转站接成 DeepSeek Harness 里的
一条 pi-ai 路由，基础地址、API Key、出站兼容开关都在「插件」设置页里填，不用改文件、
不用重装。站点地址已经写在 `lib/site.js` 里，装上就是零配置可用。

这是一个**骨架**：核心链路（路由存活 + 出站围栏 + 凭据写入 + 设置卡 + 密钥/模型向导）
已经完整可跑，余额 / 用量 / 计费 / 健康探测四项留了明确的接缝，等着填。

装好后侧边栏「插件」下面会多一行 **API3D**：点进去填一次密钥、勾选站点上的模型，
就能直接用。详见「密钥与模型向导」。

## 设计取舍

一句话：**协议、模型目录、思考档位都是配置，不是代码；插件只负责「让请求真的被中转站接受」。**

- **不自研 `LlmAdapter`。** 自研一个 provider 适配器意味着复刻 harness ↔ pi-ai 的整个
  转换层（官方那个约 1000 行：Context 组装、StreamChunk 翻译、replay 状态、
  上下文溢出判定）。单站场景不值这个价。所以路由仍然**由官方适配器执行**，只是不写死在
  补丁层里：宿主半在解析期把一条 `llm-pi-ai.providers.api3d` 装进正在运行的配置。
- **不声明「空路由」。** pi-ai 拒绝一条解析不出任何模型的自定义路由（配置校验会报
  *resolves no models; the installed catalog does not describe this route*）。
  所以**没导入任何模型时，本插件一条 provider 都不声明**：设置里不会多出 API3D 条目，
  模型选择器里也没有 API3D 分组。向导导入之后路由才出现，选择器立刻跟上，不用重启。
- **运行时装配有两个坑，插件就是为它们存在的**（见下）。

### 坑一：profile 补丁层会把整条路由挤掉

profile 自己的 `llm-pi-ai.providers` 补丁在**每个 bundle 层之后**应用，而 loader 的
合并是「一层深」的：补丁里的 `config` 是**赋值**而不是深合并，所以整个 `providers`
字典会被替换。任何自带 provider 的 profile（随包发行的 `desktop` profile 就是）
都会丢掉本插件声明的路由。

装路由的时机就挂在解析期：`ctx.on('internal/config', …, { global: true })` 里把带着
**导入目录**的路由补回去，再通过 `ctx.get('loader')` 找到 `llm-pi-ai` 条目、
`entry.update({ config })` 写回（启动时也会试写一次）。没有导入目录时这一步整个跳过 ——
既不装路由，也不去动别人同名的那条。

> 为什么不能只写一次：宿主 profile 的 watcher 会在启动后几秒重读补丁文件，
> 把一次性写入回滚。必须每次解析都补。

补回去的时候用的是**「本插件自己那条说了算」**的写法（`replace`）：解析出的 `providers`
里已经有 `api3d` 时，只要它与要写的路由完全一致就跳过（值没变就不写，免得自己触发自己
的解析风暴），否则整条替换。这里有个很容易踩的坑：`internal/config` 监听器的**第一个参数
是宿主解析出来的 `llm-pi-ai` 配置，不是本插件的设置** —— 两者曾经同名，结果每次解析都拿
模板里的默认目录把导入的那份盖回去，表现就是「模型导入了，但选择器里永远只有一条」。
现在两个参数名分开写，要装的路由一律由插件设置算出（`routeValue`），不再因为
「同名路由已存在」而提前返回。

### 坑二：baseURL 由适配器逐请求解析，但它读不到本插件的设置

两个命名空间。所以路由的 `baseURL` 指向一台**刻意不存在**的主机
（`upstream.api3d.invalid`，RFC 2606 保留顶级域），围栏在出站时把它改写为设置里的
真实地址。

这么绕的好处是「换机房」变成设置页里的一次写入；坏处是**围栏必须在请求路径上**，
包括每一台真实端点 —— 否则 DNS 直接失败（这是刻意的大声失败，比静默打到某台真实
服务器好）。

顺带，围栏还承担了中转站常见的出站兼容：

| 出站兼容 | 为什么需要 |
| --- | --- |
| 改写 baseURL | 见上 |
| 可选替换 `User-Agent` | 有些站点按 UA 认证，而适配器会剥掉与它归属头冲突的 profile header |
| 可选直连（绕过进程代理） | 站点 WAF 常把数据中心出口 IP 判成挑战，回 200 HTML 而不是 SSE |
| 可选补 `required: []` | 站点转发到严格上游时，缺 `required` 的工具 schema 会被拒 |
| 可选静默重试 | 站点多通道转发，个别通道把本可重试的请求判成 400 |
| 402 额度错误加提示 | 站点用 402 + 被错标成 `text/event-stream` 的 JSON 报额度耗尽 |

## 目录

| 路径 | 作用 |
| --- | --- |
| `lib/site.js` | **身份常量唯一来源**：包名、行 id、provider 名、哨兵主机、默认凭据引用名。换站点先改这里 |
| `cordis.patch.yml` | 组合包补丁层：**只插入插件行**（`- insert:`）。路由不在这里声明，见「设计取舍」 |
| `lib/index.js` | 宿主半：围栏、路由存活、配额注解、设置命名空间 |
| `lib/client.js` | 浏览器半：设置卡（基础地址、API Key、兼容开关、预留的运维行）、侧边栏入口、密钥/模型向导 |
| `lib/route.js` | **手写**：`ROUTE`（路由骨架，**不含 `models`**）与 `MODEL_TEMPLATE`（向导每行的能力初值） |
| `lib/direct-fetch.js` | 直连传输（`node:http`/`node:https`，绕开进程代理） |
| `scripts/probe-models.mjs` | 用真实 key 打一次 `GET {baseURL}/models`，与**设置里已导入的目录**做 diff |
| `test/` | 135 项断言，见下 |

## 安装与分发

装进某个 profile。[English](README.en.md)

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| **npm** | `dsh plugin --profile web add dsh-api3d` | 已发布 **`dsh-api3d@0.2.6`**；查询顺序：profile 配置的 registry → `registry.npmmirror.com` |
| **GitHub 直装** | `dsh plugin --profile web add github:ptb-xiaou/dsh-api3d` | 仓库里 `lib/` 就是成品，没有构建步骤，装完即用 |
| **tarball** | `dsh plugin --profile web add https://registry.npmjs.org/dsh-api3d/-/dsh-api3d-0.2.6.tgz` | 也接受本地绝对路径的 `.tgz`；GitHub Releases 可以放同一份 tgz |
| **本地路径** | `dsh plugin --profile web add E:\path\to\dsh-api3d` | 开发用；建议装进隔离实例，别装进正在用的主实例 |

装完**重启 DSH**：插件行是 boot graph 的一部分，热载不生效。

三个实测事实（在干净隔离实例上走真实安装路径验过两遍：一次是 `npm pack` 产出的
tarball，一次是 npm 渠道的 `add dsh-api3d`；两次的启动日志都打出
`api3d: 路由 api3d → …`）：

1. `add` 会自动把 `dsh-api3d` 追加进该 profile `package.json` 的
   `dsh.profile.bundles`，不用手工编辑；`dependencies` 一并写入。
2. 装好的包是 `profiles/<profile>/node_modules/dsh-api3d` 下的**真实目录**，而且
   **它自己不需要 `node_modules`**：宿主半的 `import '@deepseek-ai/schemastery'`
   由 profile 内的解析层路由到应用自带的那一份。只有本地开发（插件在 profiles 目录
   之外）才需要自己软链宿主依赖，见「开发」。
3. 浏览器半同样被认出来：实例返回的 HTML 里模块清单含 `dsh-api3d`
   （`url: plugins/??dsh-api3d/client.js&rev=…`，带 `inject` 列表）。刚装好、还没导入
   模型时启动日志打出的是 `api3d: 尚未导入模型 → 暂不声明 api3d 路由`，导入之后变成
   `api3d: 路由 api3d → https://api3d.cn/v1，模型目录 N 个（从站点导入）：…`。

关于**版本兼容闸门**：插件管理器会检查 `peerDependencies` 里以 `@deepseek-ai/dsh`
开头的条目是否满足当前 DSH 版本，不满足就拒绝安装（除非在 profile 的
`compatibility.json` 里按精确版本开豁免）。本包只声明
`@deepseek-ai/cordis` / `@deepseek-ai/schemastery`，不在闸门范围内，所以不会卡住安装；
代价是本包**不做运行时版本自检** —— DSH 大版本升级后如果插件报错，请开 issue。

> **安全提醒**：本包的宿主半在 DSH 进程内运行，**不受工作区沙箱限制**，并且会拿到
> API Key。装之前请读 `lib/index.js`。

### 发布（维护者）

`lib/`（含手写的 `lib/client.js` 与 `lib/route.js`）是**提交进版本库的成品**，
所以 `github:` 直装不需要任何构建步骤。

- **npm**：已发布 **`dsh-api3d@0.2.6`**（官方 registry 的 `latest`），registry 记录的
  `dist.shasum`（`6e3aa743d8…`）与官方 tarball 实际下载并算出的 SHA-1 一致（330153 字节）。`npm pack` 核对只打包 15 个文件 —— `lib/` 5 个 + `cordis.patch.yml` +
  `README.md` + `README.en.md` + `LICENSE` + `NOTICE` + `package.json` + `docs/` 4 张向导截图
  （330.2 kB 打包 / 492.8 kB 解开）；`test/`、`scripts/` 由 `files` 白名单挡在外面
  （`docs/` 从 0.2.1 起进白名单 —— 否则 npm 页面上的 README 截图是断图）。
  发版用能直接发布的 token；若账号被要求走暂存发布，`npm publish` 会报
  `E_STAGE_REQUIRED`，此时改用 `npx npm@11 stage publish` + `stage approve`（后者需要 2FA）。
  若 npm 上名字被占用，改成带 scope 的名字，并把本文档里的命令同步改掉。
- **发完必须核对**，而且要绕过两层缓存：本机全局 npmrc 把 registry 指到了
  `registry.npmmirror.com`（镜像同步慢且不全，曾经在 0.2.1 早已上线时 `npm view` 还报
  `latest: 0.1.1`），而即使加了 `--registry=https://registry.npmjs.org/`，npm 自己也会缓存
  响应（0.2.3 发布 5 分钟后 `npm view` 仍报 0.2.2）。可靠做法是直接抓 packument JSON：
  `Invoke-RestMethod https://registry.npmjs.org/dsh-api3d`，看 `versions`、`dist-tags` 与每条
  `dist.shasum`；再用 `https://registry.npmjs.org/dsh-api3d/-/dsh-api3d-<版本>.tgz` 下载并核对
  SHA-1。另外 `npm publish` 打印 `+ dsh-api3d@x.y.z` 只代表**已受理**（同一句还有
  `being processed`）：packument 会先出现，tarball 在 CDN 上要再过几分钟才 200。
- **GitHub Releases**：把 `npm pack` 的 tgz 传上去，使用者可用上面的 tarball 直装。
- 打标签前跑一遍 `npm test`（135 项）。

## 密钥与模型向导

装好后**不用先记字段**：侧边栏「插件」下面会多一行 **API3D**，点进去就是向导
（面板第一次打开、且还没导入模型时会自动弹出）：

1. 填站点密钥（基础地址已预填 `https://api3d.cn/v1`），点「确认并查询模型」。
   还没有密钥的话，输入框下方有一条「还没有 API Key？前往 api3d.cn 获取」，
   点它在系统浏览器里打开站点注册页（宿主按外链处理，不会在应用内嵌窗口里跑）。
2. 宿主半拿这把 key 去 `GET {baseURL}/models`，把站点实际在售的模型列出来。
3. 勾选要用的模型，点「导入所选模型」。

密钥框不会把整串藏起来：失焦时显示成 `api3d-…cdef`（首尾可见、中段打码），点进输入框
才显示完整值。填过一次之后，框右侧的下拉按钮会列出**最近用过的 5 把密钥**（最新的在最前，
列表里同样只显示打码形式），选一条就能直接用它去查询，不用重新粘贴；旁边的「清空历史」
把它删掉。历史记在 `$DSH_HOME/.credentials.yaml` 的 `<apiKeyEnv>_HISTORY`
（默认 `API3D_API_KEY_HISTORY`）里，与密钥本身同处一个文件。

**下拉里的密钥是宿主代取的。** DSH 的凭据服务是单向的：`describe` 只回答「某个引用名配没配」，
没有任何读路径会把值交给页面（这也是 DSH 的既定设计）。所以这条列表由宿主半从凭据库读出、
只把 `api3d-…cdef` 这样的**打码标签**发给浏览器；选中时浏览器只回一个序号
（`POST /api/api3d.keys` 拿清单、`keyIndex` 随查询/导入请求回传），真实值全程不出宿主进程。
「清除历史」也只是让宿主 `unset` 那条派生引用。

**第 2 步列出的不只是名字。** 每行都带一条能力摘要（形如
`输入 文本 · 上下文 1,000,000 · 最大输出 384,000 · 5 档推理`），行尾的「调整能力」可以
逐条展开修改：

| 控件 | 落到路由描述符的字段 | 初值 |
| --- | --- | --- |
| 输入：文本 / 图像 | `input` | 只勾「文本」 |
| 上下文 | `contextWindow` | 能力模板的初值（1,000,000） |
| 最大输出 | `maxTokens` | 同上（384,000） |
| 推理档位：关闭 / minimal / low / medium / high / xhigh / max | `reasoningEfforts` | 能力模板那 6 档（`off` = 提供 Off 但不发该字段） |

每行的能力**互相独立**：改一行不影响其它行，也不改能力模板（`lib/route.js` 的
`MODEL_TEMPLATE`）。数字留空表示「用模板里的值」。

要注意的是：`api3d.cn` 的 `/v1/models` 只回 `id` 与 `display_name`，不报输入模态、上下文
窗口或推理档位，所以这里的初值是本插件的内置默认，**不是站点声明的值**。勾「图像」或加档位
之前先确认站点真的支持，否则请求会被上游拒绝。合法词汇表由 DSH 的 `dsh-llm-pi-ai` 适配器
定义：模态只有 `text` / `image`，档位只有 `off` / `minimal` / `low` / `medium` / `high` /
`xhigh` / `max`；勾成别的会在执行时被适配器拒掉。站点**真报了的**能力字段（`input` /
`input_modalities` / `context_window` / `max_input_tokens` / `limit.context` /
`max_output_tokens` / `top_provider.max_completion_tokens` 等常见写法）会被直接采用，
站点没报的才回落默认 —— 「没说」与「说了不支持」是两件事，不会互相冒充。

导入时做三件事：密钥写进 `$DSH_HOME/.credentials.yaml`、勾选的目录（连同各自的能力）写进
本插件设置 `models`、再由宿主把目录装成 `llm-pi-ai` 路由。模型选择器立刻能看到它们，
不用重启 —— 第一次导入之前，设置与选择器里都没有 API3D 这一项。

`/api/api3d.apply` 把目录放在**请求体**里（而不是回头去读插件设置），所以即使那一刻设置
还没重新解析，装回去的也一定是刚勾选的那份；解析期钩子随后会用设置里的同一份目录覆盖
任何同名的 `api3d` 路由（本插件自己那条说了算）。

补丁层里**完全没有** `- id: llm-pi-ai` 条目也能导入：条目缺失、或它的形态不是键值对时，
宿主半把它当作一份空配置，从零建出 `providers.api3d` 写回去 —— 不会再出现「配置不可合并」
这类拒绝。（0.2.5 之前这里会报错，等于要求用户先手写一条 `llm-pi-ai` 声明才用得了向导。）

为什么查询要绕到宿主：`api3d.cn` 的 `/v1/models` 不返回任何 `access-control-*`
头，浏览器直接请求会被跨域预检挡成 403。向导背后的两条宿主路由是：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/api/api3d.models` | POST `{apiKey, baseURL?}` | 宿主侧查站点模型目录，返回归一后的目录（站点真报了的输入模态/上下文/最大输出/推理档位一并带上）与一组 `defaults`（向导每行的初值） |
| `/api/api3d.apply` | POST `{models?}` | 把请求体里的目录（缺省则用设置里已导入的那份）装回 `llm-pi-ai` 路由；补丁层没有 `llm-pi-ai` 条目时也会从零建出并写入 |

两条都注册在 `connection.fetch` 的精确路由表上，所以自动带 DSH 的 Host/Origin
围栏与浏览器会话鉴权；未授权的请求到不了处理函数。

设置卡里的字段仍然可用（等价入口）。向导只是把「填密钥 + 挑模型」这两步自动化；
出站兼容开关（UA、直连、schema 补全、静默重试、配额提示）仍在设置卡上。

这条链路已在隔离开发实例里用真实密钥跑通（填 key → 查询 → 勾选 → 导入），

| 第 1 步：填密钥 | 第 2 步：勾选模型 | 导入完成 |
| --- | --- | --- |
| ![填写 API Key](docs/wizard-step1-key.png) | ![勾选要导入的模型](docs/wizard-step2-models.png) | ![导入完成](docs/wizard-step3-done.png) |

第 2 步展开「调整能力」后（同样是真站点、真密钥跑出来的，这行改了输入模态、上下文与最大输出）：

![逐条调整输入模态、上下文窗口、最大输出与推理档位](docs/wizard-step2-caps.png)

导入后重启开发实例，日志从 `尚未导入模型 → 暂不声明 api3d 路由` 变成
`模型目录 N 个（从站点导入）：…`，证明目录确实落了盘并被重新读回。不重启时由
`/api/api3d.apply` 当场把路由装好，选择器也已经能看到 —— 两条路都真机验过。

## 配置

装好后在「插件」页找到本插件，设置卡上填：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| 基础地址 `baseURL` | `https://api3d.cn/v1` | 站点地址，默认已填好。**显式清空不是「用默认」，是围栏不改写、请求打到哨兵主机并 DNS 失败** |
| 凭据引用名 `apiKeyEnv` | `API3D_API_KEY` | 密钥存放位置的**键名**，不是密钥。要与 `lib/route.js` 里的 `apiKeyEnv` 一致 |
| API Key | — | 单独一个按钮写入 `~/.dsh/.credentials.yaml`。单向写入，没有任何读路径会把它取回来 |
| 导入的模型目录 `models` | 空 = 不声明路由 | 向导写入的 JSON 目录，**不用手填**。留空时「设置 → 模型」与模型选择器里都不会有 API3D；清空后需重启一次才撤下已经装上的路由 |
| User-Agent | 空 | 留空保留 harness 归属头（推荐）。只有站点明确要求某个值时才填 |
| 直连策略 `directMode` | `auto` | `auto` = 只有进程真的设了代理变量才直连；`always` / `never` 用于排查 |
| 补工具 schema | 开 | 出站工具 schema 的对象节点补 `required: []` |
| 静默重试 `silentRetry` | 关 | 站点以上游瞬时错误拒绝时在插件内部重发。默认关：静默掩盖真正的 400 会把可见错误换成一个令人困惑的空回合 |
| 重试次数 `silentRetryAttempts` | 3 | 含首次，1–10 |
| 配额提示 `quotaHint` | 空 | 附加到 402 额度耗尽错误后的说明文字。留空关闭 |

`claimRoute`（默认开）与 `announce`（默认开）不是设置卡字段，在 `cordis.patch.yml`
或 profile 的 patch 里改。

### 换成别的站点要改的地方

（本站 API3D 的地址与模型都已经填好，下面只在需要换站点 / 换线路时看。）

模型清单**不在代码里**：它来自向导导入的那份目录（存在插件设置 `models`）。站点在售的
模型、以及每条的能力（输入模态 / 上下文 / 最大输出 / 推理档位）都由向导写入，
`lib/route.js` 的 `MODEL_TEMPLATE` 只是向导每行的初值。

2026-10-20 实测：`GET https://api3d.cn/v1/models` 返回 `deepseek-v4.1-flash`。
**api3d.cn 上的 `deepseek-v4.1-flash-1017` 属于福利分组，要另一把 key**
（`SUB2API_ONLINE_WELFARE_KEY`）；用主 key 请求它会得到 `404 model_not_found`。
分组不同 = 凭据不同 = 应该是另一条 provider 路由，不能并进同一条路由的模型列表 ——
所以向导只列这把 key 真正能用的模型。

想核对「站点现在到底有哪些模型」，别凭厂商名猜：

```bash
npm run probe-models                      # 用 $API3D_API_KEY 打 GET {baseURL}/models
npm run probe-models -- --ref SUB2API_API_KEY   # 或者从凭据库里取某条引用
npm run probe-models -- --profile desktop       # 指定读哪个 profile 里已导入的目录
```

脚本做一次只读 GET，把站点自报的 id 与**设置里已导入的目录**做 diff，并打印还差哪些。
要改目录就走向导（侧边栏 API3D → 重新选择模型），不用手改文件。

1. **模型目录** —— 走向导导入，落到插件设置 `models`，每条的能力一并写入。路由由宿主半
   在解析期装配，`lib/route.js` 的 `ROUTE` 只留与站点无关的骨架（provider 名、哨兵地址、
   `apiKeyEnv`、`api`、`defaultInput`、`compat`）。
2. **`reasoningEfforts` 的拼写** —— 键是选择器提供的档位，值是实际发出的
   `reasoning_effort`。向导按 `MODEL_TEMPLATE` 铺 6 档，`off` = 提供 Off 且不发送该字段。
   有些站点要求显式 `none` 且拒绝 `off`，在向导里逐条改。
3. **`lib/site.js`** —— 只有在你想改哨兵主机 / 默认凭据引用名 / provider 名时才需要。
   改完 `npm test` 即可（`route.test.mjs` 会核对它与 `lib/route.js` 是否一致）。

## 预留的接缝：余额 / 用量 / 计费 / 健康探测

设置卡上已经有四行占位：**余额 / 用量 / 计费 / 健康探测**，目前渲染「未接入」。

接缝的粒度是**行**而不是数字：`OPS_ROWS` 定义有哪几行，取值全部走 `opValue`。
填真数据时只动 `opValue` 一处，不动布局。

两条实现路径：

- **纯管控面（推荐先做）** —— 如果你有 `GET /api/user/balance` 这类接口，做一个纯管控
  面插件即可：`Config` + `slots.register` 卡片 + 宿主侧一个 fetch 轮询。不需要注册
  provider，也不需要碰 `globalThis.fetch`。
- **Remote 服务** —— 需要在浏览器半按需查询时，宿主半继承
  `@deepseek-ai/dsh-typert-protocol` 的 `TypertRemoteService`
  （`super(ctx, serviceKey, { namespace })` + `@Remote` 装饰方法），浏览器半
  自己 `ctx.remote.$mount(…)`。约束较硬：描述符的 codec 必须是
  `mode: 'strict'`（否则 `$mount` 直接抛），宿主方法的参数必须是朴素标识符、
  `signal` 只能放最后。本机没装 `@deepseek-ai/dsh-typert-generator`，所以描述符
  要手写 —— 这也是本骨架先不做它的原因。

## 开发

```bash
npm run probe-models  # 核对站点实际提供的 id 与已导入目录的差异
npm test              # node --test "test/*.test.mjs"（135 项）
```

依赖是**软链到宿主 `node_modules`** 的（`@deepseek-ai/schemastery` / `js-yaml` /
`react`），因为 harness 包必须是宿主的**同一份实例**（`instanceof` 安全），不能从
registry 装真拷贝。`@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 声明为
可选 peer。

测试覆盖：

| 文件 | 覆盖 |
| --- | --- |
| `route.test.mjs` | 补丁层不再声明路由、`ROUTE` 不带 `models`、`MODEL_TEMPLATE` 的词汇表、钩子的「补 / 换 / 无目录就不动」语义 |
| `fence.test.mjs` | 围栏：改写、白名单、非目标请求原样透传、清理时只还原本插件装的 fetch |
| `tool-schema.test.mjs` | `required: []` 补齐与 `strict: true` 跳过 |
| `silent-retry.test.mjs` | 瞬时失败判定、退避、次数上限 |
| `claim.test.mjs` | `entry.update` 写回；同名路由的三种归属（本插件 / 别人 / 缺失）；**导入目录压过别处那条同名路由**；**没有导入目录时一条路由都不声明**；值没变就不写 |
| `direct-transport.test.mjs` | 直连传输打真实 loopback 替身：header 保真、不跟随重定向、abort 切断连接 |
| `integration.test.mjs` | **端到端**：围栏 + 直连传输真的把请求送到一台 TCP 服务器；402 额度注解的边界 |
| `client-bundle.test.mjs` | 浏览器半装载契约：两半的设置命名空间必须逐字相等、六个槽位（含侧边栏入口与 `shell.overlay` 向导）、字典、向导第一步「前往 api3d.cn 获取」外链的地址与 `target`/`rel`、密钥框打码只藏中间（`maskKey`）、**选中历史条目也算「有密钥可用」**（`hasKeySource` —— 真机故障回归）、三条宿主路由字面量防漂移、**表单控制器以原型方法提供时不能丢 `this`**（真机崩溃回归） |
| `models.test.mjs` | 向导的宿主半：目录归一（含站点上报的能力字段与「没说就不编造」的边界、能力字段往返）、`discoverModels` 失败分类与 `defaults`、逐模型落能力覆盖（不改模板）、`applyImportedModels` 写回、两条 `/api/api3d.*` 路由的注册与鉴权边界 |

## 已知限制

- **单站。** 只支持一个基础地址。多站请用通用网关 provider 类插件。
- **模型目录只来自向导导入。** 目录存在插件设置 `models` 里（落进 profile 补丁层，重启仍
  生效），每条可以带自己的 `input` / `contextWindow` / `maxTokens` / `reasoningEfforts`。
  **没导入就一条路由都不声明** —— pi-ai 不允许空模型路由，所以刚装好时选择器里没有
  API3D；清空设置后要重启一次才撤下已装上的路由。适配器自带的自动发现仍然不用 ——
  它去哨兵主机发现必然失败，见「坑二」。
- **能力初值来自本插件的能力模板，不是站点声明。** `api3d.cn` 的 `/v1/models` 不报能力，
  所以向导里看到的上下文窗口、最大输出与推理档位都来自 `MODEL_TEMPLATE`，需要按站点实际
  能力逐条改；勾错了由上游拒绝。
- **密钥由向导代写。** 向导把这把 key 写进 `$DSH_HOME/.credentials.yaml` 的
  `API3D_API_KEY`；也可以手动在设置卡或「设置 → 模型 → API3D」里填，两条路等价。
  已配置后卡片上才出现「清除密钥」。
- **密钥与历史在磁盘上都是明文。** 密钥框失焦时显示成 `api3d-…cdef` 只是**界面上的**打码，
  `$DSH_HOME/.credentials.yaml` 里存的仍是明文（和 DSH 里其它密钥一样）；最近 5 把历史
  密钥也在同一文件里（`<apiKeyEnv>_HISTORY`），点向导里的「清空历史」才会删掉。
  但明文只在宿主进程与这个文件之间流动：浏览器拿到的永远只是打码标签与一个序号，
  密钥值本身不会被页面读到（凭据 Remote 单向）。
- **余额 / 用量 / 计费 / 健康探测未接入。** 接缝已就位，见上。
- **`directMode: never` 在站点 WAF 拦截数据中心出口时会失败**，这是预期行为。

## 出处与许可

MIT。衍生自 [aqiu817/dsh-llm-agentrouter](https://github.com/aqiu817/dsh-llm-agentrouter)
（MIT，Copyright (c) 2026 aqiu817）—— 围栏、路由自愈、静默重试、直连传输与设置卡的
骨架来自该项目，已按单站场景重构并补充了凭据写入与运维接缝。`LICENSE` 保持标准 MIT
全文（含原始版权声明），衍生与参考实现的说明单独放在 `NOTICE` 里 —— 这样 GitHub 的
许可证识别能正常标出 MIT，而归属信息也不会丢。

参考实现 [Luck9Star/dsh-gateway-provider](https://github.com/Luck9Star/dsh-gateway-provider)
（MIT，Copyright (c) 2026 Luck9Star）提供了「运行时注册 provider 路由」的路线，本骨架
走的也是运行时装配（按需装、没导入就不装），理由见开头。
