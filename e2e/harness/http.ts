import { createServer } from 'node:http'

/** An actual loopback endpoint; record every request to prove policy and headers. */
export async function startFetchTarget() {
  const userAgents: (string | undefined)[] = []
  const server = createServer((request, response) => {
    userAgents.push(request.headers['user-agent'])
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('web-fetch-enhanced loopback fixture')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No loopback port assigned')
  return {
    url: 'http://127.0.0.1:' + address.port + '/',
    userAgents,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}
