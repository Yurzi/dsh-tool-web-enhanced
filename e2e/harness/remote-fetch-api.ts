import { createServer, type IncomingHttpHeaders } from 'node:http'

export interface RemoteFetchRequest {
  readonly method: string
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly body: string
}

export interface RemoteFetchResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

/** A fake remote service that only listens on loopback and retains the complete wire request. */
export async function startRemoteFetchApi(initialResponse: RemoteFetchResponse | ((request: RemoteFetchRequest) => RemoteFetchResponse | Promise<RemoteFetchResponse>)) {
  const requests: RemoteFetchRequest[] = []
  let reply = initialResponse
  const server = createServer((request, response) => {
    const { method, url: path } = request
    if (method === undefined || path === undefined) {
      response.destroy(new Error('The HTTP request has no method or path'))
      return
    }
    const received = { method, path, headers: { ...request.headers }, body: '' }
    requests.push(received)
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('error', (error) => { response.destroy(error) })
    request.on('end', async () => {
      received.body = Buffer.concat(chunks).toString('utf8')
      const result = typeof reply === 'function' ? await reply(received) : reply
      response.writeHead(result.status, result.headers)
      response.end(result.body)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No fake remote API port assigned')
  return {
    url: 'http://127.0.0.1:' + address.port + '/',
    requests,
    respondWith(response: RemoteFetchResponse) { reply = response },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}
