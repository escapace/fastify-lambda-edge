import type {
  CloudFrontHeaders,
  CloudFrontRequest,
  CloudFrontRequestEvent,
  CloudFrontResultResponse,
  Context
} from 'aws-lambda'
import type {
  FastifyInstance,
  HTTPMethods,
  LightMyRequestResponse
} from 'fastify'
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http'
import { forEach, isString, sortBy } from 'lodash-es'

const RESPONSE_HEADERS_DENY_LIST = ['connection', 'content-length', 'date']

interface Options {
  callbackWaitsForEmptyEventLoop: boolean
  binaryMimeTypes: string[]
}

const querystringFromRequest = (request: CloudFrontRequest) => {
  const map = new Map<string, string[]>()

  forEach(
    Array.from(new URLSearchParams(request.querystring)),
    ([key, value]) => {
      if (map.has(key)) {
        map.get(key)?.push(value)
      } else {
        map.set(key, [value])
      }
    }
  )

  return Object.fromEntries(
    sortBy(Array.from(map.entries()), ([value]) => value)
  )
}

const bodyFromRequest = (request: CloudFrontRequest) => {
  const { body } = request

  return body === undefined
    ? undefined
    : Buffer.from(body.data, body.encoding === 'base64' ? 'base64' : 'utf8')
}

const headersFromRequest = (request: CloudFrontRequest) => {
  const { headers } = request

  const values: IncomingHttpHeaders | OutgoingHttpHeaders = {}

  Object.entries(headers).forEach(([key, value]) => {
    values[key] = value.map((header) => header.value).join(',')
  })

  return values
}

const headersFromResponse = (
  response: LightMyRequestResponse
): CloudFrontHeaders => {
  const values: CloudFrontHeaders = {}

  Object.entries(response.headers).forEach(([key, value]) => {
    const keyLowerCase = key.toLowerCase()
    if (RESPONSE_HEADERS_DENY_LIST.includes(keyLowerCase)) {
      return
    }

    if (value === undefined) {
      return
    }

    if (values[keyLowerCase] === undefined) {
      values[keyLowerCase] = []
    }

    if (!Array.isArray(value)) {
      values[keyLowerCase].push({
        key: keyLowerCase,
        value: `${value}`
      })

      return
    }

    const headersArray = value.map((v) => ({
      key: keyLowerCase,
      value: v
    }))

    values[keyLowerCase].push(...headersArray)
  })

  return values
}

export default (
  app: FastifyInstance,
  options: Partial<Options> = {
    callbackWaitsForEmptyEventLoop: undefined,
    binaryMimeTypes: []
  }
) => {
  return async (
    event: CloudFrontRequestEvent,
    context: Context
  ): Promise<CloudFrontResultResponse> => {
    const request = event.Records[0].cf.request
    // const config = event.Records[0].cf.config
    if (options.callbackWaitsForEmptyEventLoop !== undefined) {
      context.callbackWaitsForEmptyEventLoop =
        options.callbackWaitsForEmptyEventLoop
    }

    const requestBody = bodyFromRequest(request)
    const requestQuerystring = querystringFromRequest(request)
    const requestHeaders = headersFromRequest(request)

    if (requestBody !== undefined) {
      requestHeaders['content-length'] = requestBody.byteLength
    }

    try {
      const response = await app.inject({
        method: request.method as HTTPMethods,
        url: request.uri,
        query: requestQuerystring,
        payload: requestBody,
        headers: requestHeaders
      })

      const responseHeaders = headersFromResponse(response)

      const mimeType =
        responseHeaders['content-type'] === undefined
          ? undefined
          : responseHeaders['content-type'][0].value.split(';')[0]

      let bodyEncoding: CloudFrontResultResponse['bodyEncoding']
      let body: CloudFrontResultResponse['body']

      if (isString(response.body)) {
        bodyEncoding =
          options.binaryMimeTypes === undefined || mimeType === undefined
            ? 'text'
            : options.binaryMimeTypes.includes(mimeType)
            ? 'base64'
            : 'text'

        body =
          bodyEncoding === 'text'
            ? response.body
            : Buffer.from(response.body).toString('base64')
      }

      return {
        status: `${response.statusCode}`,
        statusDescription: response.statusMessage,
        body,
        bodyEncoding,
        headers: responseHeaders
      }
    } catch {
      return {
        status: '500'
      }
    }
  }
}
