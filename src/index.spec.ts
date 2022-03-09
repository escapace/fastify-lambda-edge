/* eslint-disable @typescript-eslint/no-misused-promises */
import { assert } from 'chai'
import { fastify } from 'fastify'
import fastifyLambdaEdge from './index'
import event from './origin-request.json'
import { noop } from 'lodash-es'

import { Context, CloudFrontRequestEvent } from 'aws-lambda'

const context = {
  callbackWaitsForEmptyEventLoop: noop
} as unknown as Context

describe('./src/index.spec.ts', () => {
  it('origin-request', async () => {
    const app = fastify()

    app.get('/test', async (request, reply) => {
      assert.equal(request.method, 'GET')

      assert.equal(
        request.url,
        '/test?field1=value1&field1=value2&field2=value3'
      )

      assert.deepEqual(request.query, {
        field1: ['value1', 'value2'],
        field2: 'value3'
      })

      assert.deepEqual(request.headers, {
        'x-forwarded-for': '203.0.113.178',
        'user-agent': 'Amazon CloudFront',
        via: '2.0 2afae0d44e2540f472c0635ab62c232b.cloudfront.net (CloudFront)',
        host: 'example.org',
        'cache-control': 'no-cache, cf-no-cache'
      })

      await reply
        .header('Set-Cookie', 'qwerty=one')
        .header('Set-Cookie', 'qwerty=two')
        .send({ hello: 'world' })
    })

    const handler = fastifyLambdaEdge(app)
    const response = await handler(event as CloudFrontRequestEvent, context)

    assert.equal(response.status, '200')
    assert.equal(response.statusDescription, 'OK')
    assert.equal(response.bodyEncoding, 'text')
    assert.equal(response.body, '{"hello":"world"}')

    assert.deepEqual(response.headers?.['set-cookie'], [
      { key: 'set-cookie', value: 'qwerty=one' },
      { key: 'set-cookie', value: 'qwerty=two' }
    ])

    assert.deepEqual(response.headers?.['content-type'], [
      { key: 'content-type', value: 'application/json; charset=utf-8' }
    ])
  })

  it('error', async () => {
    const app = fastify()

    app.get('/test', () => {
      throw new Error('Error')
    })

    const handler = fastifyLambdaEdge(app)
    const response = await handler(event as CloudFrontRequestEvent, context)

    assert.equal(response.status, '500')
    assert.equal(response.statusDescription, 'Internal Server Error')
  })
})
