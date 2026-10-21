/**
 * 运行时形态的路由值 —— 由 `scripts/gen-route.mjs` 从 `cordis.patch.yml` 生成，
 * 不要手改。改路由请改补丁文件后跑 `npm run gen-route`。
 *
 * 为什么需要这份副本：profile 自己的补丁层在所有 bundle 层**之后**应用，而 loader
 * 的补丁合并是把补丁的 `config` **赋值**在组合结果之上 —— 只有一层深，所以
 * `providers` 整个字典是被替换而不是被合并。任何自带 provider 的 profile（随包
 * 发行的 desktop profile 就是，任何跑第二台中转站的 profile 也是）都会把这条
 * `api3d` 路由挤掉，之后每次调用都以 `NO_ADAPTER` 失败。
 *
 * 围栏通过宿主条目自己的 volatile config 把路由重新装回去，适配器在下一个请求
 * 就能看到。test/route-parity.test.mjs 断言这里的值仍等于补丁层的值。
 *
 * @module dsh-api3d/route
 */
import { PI_AI_ENTRY, PROVIDER } from './site.js'

/** 本包在 `llm-pi-ai.providers` 里拥有的路由，与 cordis.patch.yml 逐字一致。 */
const ROUTE = {
  "displayName": "API3D",
  "apiKeyEnv": "API3D_API_KEY",
  "api": "openai-completions",
  "baseURL": "https://upstream.api3d.invalid/v1",
  "defaultInput": [
    "text"
  ],
  "compat": {
    "thinkingFormat": "openai",
    "supportsReasoningEffort": true,
    "supportsDeveloperRole": false,
    "maxTokensField": "max_tokens",
    "supportsStore": false,
    "supportsStrictMode": true,
    "supportsUsageInStreaming": true
  },
  "models": [
    {
      "id": "deepseek-v4.1-flash",
      "name": "DeepSeek V4.1 Flash",
      "contextWindow": 1000000,
      "maxTokens": 384000,
      "input": [
        "text"
      ],
      "reasoningEfforts": {
        "off": null,
        "minimal": "minimal",
        "low": "low",
        "high": "high",
        "xhigh": "xhigh",
        "max": "max"
      },
      "compat": {
        "supportsReasoningEffort": true
      }
    }
  ]
}

export { PI_AI_ENTRY, PROVIDER, ROUTE }
