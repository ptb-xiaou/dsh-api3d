/**
 * 出站工具 schema 的 `required` 填充。
 *
 * 有些上游把「对象节点没有 required 数组」当成非法的 `null` 而不是省略，于是工具
 * 调用整条链路在一个本可接受的 schema 上失败。空数组与省略语义等价，所以这个填充
 * 不可能改变一个合规端点接受什么。
 *
 * @module dsh-api3d/test/tool-schema
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { relayToolSchemaPatch } from '../lib/index.js'
import { withFence } from './harness.mjs'

/**
 * 造一个请求体。
 *
 * @param {object} parameters - 工具的参数 schema。
 * @param {object} [extra] - 工具对象上的额外字段。
 * @returns {string} 序列化后的请求体。
 */
const bodyWith = (parameters, extra = {}) =>
  JSON.stringify({ model: 'm', tools: [{ type: 'function', function: { name: 't', parameters, ...extra } }] })

test('给顶层对象节点补 required: []', () => {
  const patched = relayToolSchemaPatch(bodyWith({ type: 'object', properties: { a: { type: 'string' } } }))
  assert.notEqual(patched, undefined)
  assert.deepEqual(JSON.parse(patched).tools[0].function.parameters.required, [])
})

test('递归进 properties、items 与 oneOf', () => {
  const patched = relayToolSchemaPatch(
    bodyWith({
      type: 'object',
      properties: {
        nested: { type: 'object', properties: { b: { type: 'number' } } },
        list: { type: 'array', items: { type: 'object', properties: { c: { type: 'string' } } } },
        choice: { oneOf: [{ type: 'object', properties: { d: { type: 'string' } } }] },
      },
    }),
  )
  const parameters = JSON.parse(patched).tools[0].function.parameters
  assert.deepEqual(parameters.required, [])
  assert.deepEqual(parameters.properties.nested.required, [])
  assert.deepEqual(parameters.properties.list.items.required, [])
  assert.deepEqual(parameters.properties.choice.oneOf[0].required, [])
})

test('已经有 required 数组的节点不被改动', () => {
  const patched = relayToolSchemaPatch(bodyWith({ type: 'object', required: ['a'], properties: { a: { type: 'string' } } }))
  assert.equal(patched, undefined, '没有可补的就必须原样透传')
})

test('strict 工具被跳过：它的 required 必须由作者列全', () => {
  const body = bodyWith({ type: 'object', properties: { a: { type: 'string' } } }, { strict: true })
  assert.equal(relayToolSchemaPatch(body), undefined)
})

test('非对象 schema 与其他 body 字段都不受影响', () => {
  const patched = relayToolSchemaPatch(bodyWith({ type: 'string' }))
  assert.equal(patched, undefined)

  const withScalarTool = JSON.stringify({ model: 'm', temperature: 0.5, tools: [{ type: 'function', function: { name: 't', parameters: { type: 'string' } } }] })
  assert.equal(relayToolSchemaPatch(withScalarTool), undefined)
})

test('无法解析的 body、没有 tools 的 body、空 tools 都原样透传', () => {
  assert.equal(relayToolSchemaPatch('not json at all'), undefined)
  assert.equal(relayToolSchemaPatch(JSON.stringify({ model: 'm' })), undefined)
  assert.equal(relayToolSchemaPatch(JSON.stringify({ tools: [] })), undefined)
  // tools 里没有 function.parameters 的条目也不该让整个填充行为改变。
  assert.equal(relayToolSchemaPatch(JSON.stringify({ tools: [{ type: 'function', function: { name: 't' } }] })), undefined)
})

test('填充保留 body 的其他字段', () => {
  const patched = relayToolSchemaPatch(
    JSON.stringify({
      model: 'deepseek-v4',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object', properties: {} } } }],
    }),
  )
  const parsed = JSON.parse(patched)
  assert.equal(parsed.model, 'deepseek-v4')
  assert.equal(parsed.stream, true)
  assert.deepEqual(parsed.messages, [{ role: 'user', content: 'hi' }])
  assert.equal(parsed.tools[0].function.description, 'd')
  assert.deepEqual(parsed.tools[0].function.parameters.required, [])
})

test('围栏把补好的 body 交给原生 fetch', async () => {
  const body = bodyWith({ type: 'object', properties: { a: { type: 'string' } } })
  await withFence({ baseURL: 'https://api.example.com/v1' }, async ({ calls }) => {
    await fetch('https://upstream.api3d.invalid/v1/chat/completions', { method: 'POST', body })
    assert.deepEqual(JSON.parse(calls[0].init.body).tools[0].function.parameters.required, [])
  })
})

test('patchToolSchema 关掉后请求体一个字节都不动', async () => {
  const body = bodyWith({ type: 'object', properties: { a: { type: 'string' } } })
  await withFence({ baseURL: 'https://api.example.com/v1', patchToolSchema: false }, async ({ calls }) => {
    await fetch('https://upstream.api3d.invalid/v1/chat/completions', { method: 'POST', body })
    assert.equal(calls[0].init.body, body)
  })
})
