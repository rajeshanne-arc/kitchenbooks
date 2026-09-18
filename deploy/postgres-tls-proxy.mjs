import fs from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'

const port = Number(process.env.KB_DB_TLS_PROXY_PORT || 55432)
const targetPort = Number(process.env.KB_DB_TARGET_PORT || 5432)
const key = fs.readFileSync(process.env.KB_DB_TLS_KEY || './.secrets/db-proxy.key')
const cert = fs.readFileSync(process.env.KB_DB_TLS_CERT || './.secrets/db-proxy.crt')

function bridge(client) {
  const upstream = net.createConnection({ host: '127.0.0.1', port: targetPort })
  client.pipe(upstream)
  upstream.pipe(client)
  const closeBoth = () => {
    client.destroy()
    upstream.destroy()
  }
  client.once('error', closeBoth)
  upstream.once('error', closeBoth)
  client.once('close', () => upstream.destroy())
  upstream.once('close', () => client.destroy())
}

// PostgreSQL starts TLS with an 8-byte SSLRequest packet. A normal TLS server
// cannot handle that prefix, so negotiate the protocol upgrade on the raw
// socket first and then wrap the same socket as a TLS server.
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 0xd2, 0x16, 0x2f])
const server = net.createServer((client) => {
  client.once('data', (first) => {
    if (first.subarray(0, 8).equals(SSL_REQUEST)) {
      client.write('S')
      const secure = new tls.TLSSocket(client, { isServer: true, key, cert })
      secure.once('secure', () => bridge(secure))
      secure.once('error', () => secure.destroy())
      return
    }
    client.destroy()
  })
  client.once('error', () => client.destroy())
})

server.listen(port, '127.0.0.1', () => {
  console.log(`KitchenBooks database TLS proxy listening on 127.0.0.1:${port}`)
})

process.once('SIGTERM', () => server.close(() => process.exit(0)))
process.once('SIGINT', () => server.close(() => process.exit(0)))
