/**
 * 站点身份常量 —— 换站点只改这个文件（外加 `package.json` 的 `name` 与
 * `cordis.patch.yml` 的 insert 行）。
 *
 * 之所以集中在一处：包名、loader entry id、设置命名空间、provider 路由键、
 * 哨兵主机这五个值在宿主半、补丁层和生成脚本里各出现一次，散开就一定会漂移。
 * 客户端半是浏览器产物、不能 import 宿主代码，所以它把那几个字面量自己重写一遍
 * —— 改这里之后记得同步 `lib/client.js` 中 `//#region plugin` 区的五个常量。
 *
 * @module dsh-api3d/site
 */

/** 组合包名。也是 `dsh.bundle.patch` 所属的包名，Plugins 页按它索引配置槽。 */
const BUNDLE_NAME = 'dsh-api3d'

/** 本包在补丁层里的行 id，同时是 loader entry id 与设置命名空间。 */
const ROW_ID = 'api3d'

/** 本包在 `llm-pi-ai.providers` 里拥有的 provider 键。模型选择器把它当路由名。 */
const PROVIDER = 'api3d'

/**
 * 路由 `baseURL` 里使用的主机名占位。
 *
 * 它必须是**永远解析不了**的名字：围栏没装上时请求会以 DNS 失败大声报错，而不是
 * 静默打到某台真实服务器上。`.invalid` 是 RFC 2606 保留的顶级域，比 `.internal`
 * 更硬性。
 */
const SENTINEL = 'upstream.api3d.invalid'

/** 路由 `baseURL` 里的路径前缀。围栏按它从请求路径里剥掉哨兵前缀。 */
const SENTINEL_PATH = '/v1'

/** 路由声明所在的宿主条目。围栏要按 id + 包名精确定位它。 */
const PI_AI_ENTRY = { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' }

/**
 * 站点默认基础地址。
 *
 * 填的就是本站 API3D（api3d.cn）的 OpenAI 兼容入口。填了之后插件开箱即用、
 * 零配置；留空则必须在设置页填写，否则请求会打到哨兵主机并以 DNS 失败告终
 * （这是刻意的大声失败）。换站点/换线路时在这里改，或留空交给设置页。
 */
const SITE_DEFAULT_BASE_URL = 'https://api3d.cn/v1'

/** 默认凭据引用名。注意它是**引用**不是密钥：密钥存在 ~/.dsh/.credentials.yaml。 */
const DEFAULT_API_KEY_ENV = 'API3D_API_KEY'

export {
  BUNDLE_NAME,
  DEFAULT_API_KEY_ENV,
  PI_AI_ENTRY,
  PROVIDER,
  ROW_ID,
  SENTINEL,
  SENTINEL_PATH,
  SITE_DEFAULT_BASE_URL,
}
