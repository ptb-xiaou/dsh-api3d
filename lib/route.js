/**
 * 本包要装进 `llm-pi-ai.providers` 的那条路由骨架（`ROUTE`），以及新模型描述符的
 * 能力模板（`MODEL_TEMPLATE`）。
 *
 * ── 为什么路由**不**写在补丁层里 ──────────────────────────────────────────
 * pi-ai 拒绝一条零模型的声明式路由：`resolveRouteModels()` 在一条既不在它自带目录
 * 里、又解析不出任何模型的 provider 上，会以
 *
 *     resolves no models; the installed catalog does not describe this route,
 *     so its models must be listed in configuration
 *
 * 直接判为配置错误。而本插件的模型目录来自站点查询（向导），**安装那一刻是空的**
 * —— 也就是说「补丁层声明一条路由」与「装完不显示任何模型」不可兼得。所以
 * `cordis.patch.yml` 只插入插件行，路由由宿主半在「设置里有导入的模型」时才装进
 * `llm-pi-ai`。
 *
 * ── 为什么还要在运行时装一次 ───────────────────────────────────────────────
 * profile 自己的补丁层在所有 bundle 层**之后**应用，而 loader 的补丁合并是把补丁的
 * `config` **赋值**在组合结果之上 —— 只有一层深，所以 `providers` 整个字典是被替换
 * 而不是被合并。任何自带 provider 的 profile（随包发行的 desktop profile 就是，任何
 * 跑第二台中转站的 profile 也是）都会把这条路由挤掉。宿主半通过宿主条目自己的
 * volatile config 把路由重新装回去，适配器在下一个请求就能看到。
 *
 * @module dsh-api3d/route
 */
import { PI_AI_ENTRY, PROVIDER } from './site.js'

/**
 * 本包在 `llm-pi-ai.providers` 里拥有的路由骨架。
 *
 * 刻意**不带 `models`**：模型目录逐次来自设置里导入的那份，见
 * {@link MODEL_TEMPLATE} 与 `lib/index.js` 的 `routeOfCatalog()`。直接把这份骨架装上去
 * 会是一条零模型路由，pi-ai 会拒绝它。
 */
const ROUTE = {
  displayName: 'API3D',
  apiKeyEnv: 'API3D_API_KEY',
  api: 'openai-completions',
  // 哨兵主机：由 lib/index.js 的围栏逐请求改写为设置里的基础地址。
  baseURL: 'https://upstream.api3d.invalid/v1',
  defaultInput: ['text'],
  // 你的站点不是 pi-ai 能识别的厂商端点，不声明的话它会按 OpenAI 本尊来处理
  // （用 developer 角色和 max_completion_tokens）。这组是「通用 OpenAI Chat
  // Completions 中转站」的安全默认值。
  compat: {
    thinkingFormat: 'openai',
    supportsReasoningEffort: true,
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens',
    supportsStore: false,
    supportsStrictMode: true,
    supportsUsageInStreaming: true,
  },
}

/**
 * 新模型描述符的能力模板：向导导入的每条模型都以它为底，再落上这条自己报出
 * （或用户在向导里改过）的能力。
 *
 * 站点通常一个能力字段都不报 —— api3d.cn 的 `/v1/models` 只有 `id` 与
 * `display_name` —— 所以模板是「这条没被覆盖」时的兜底，不是站点声明。
 * `id` / `name` 只是占位，每条导入的模型都会覆盖它们。
 *
 * `reasoningEfforts` 的键是模型选择器提供的档位，值是实际发出的 `reasoning_effort`
 * 拼写；`off: null` = 提供 Off 且不发送该字段。
 */
const MODEL_TEMPLATE = {
  id: 'deepseek-v4.1-flash',
  name: 'DeepSeek V4.1 Flash',
  contextWindow: 1000000,
  maxTokens: 384000,
  input: ['text'],
  reasoningEfforts: {
    off: null,
    minimal: 'minimal',
    low: 'low',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  compat: {
    supportsReasoningEffort: true,
  },
}

export { MODEL_TEMPLATE, PI_AI_ENTRY, PROVIDER, ROUTE }
