import type { AddressInfo } from 'node:net'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import { SendToOpenListConnector, SendToOpenListConnectorError } from '../src/modules/builtin/send-to-openlist/connector'

/** Opt-in local acceptance: real, pinned servers on a disposable network with no external egress. */
const images = [
  { kind: 'openlist', image: 'openlistteam/openlist@sha256:c555c6e1c8af2aead38ed12ec761ac077fdf046d19cf033414be8e056aec6b64', root: '/opt/openlist', version: 'v4.2.6', commit: '2bdf16d' },
  { kind: 'alist', image: 'xhofe/alist@sha256:30a8e42c7dc899477e6fee99fc858833a1ec159b43f81782932c04fe127d7c1f', root: '/opt/alist', version: 'v3.64.0', commit: '3e49fa4' },
] as const

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 }).trim()
}

function clientId(profileId: string, origin: string) {
  let hash = 2166136261
  const source = `${profileId}\0${origin}`
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `oneweb-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

async function until<T>(read: () => Promise<T>, accept: (_value: T) => boolean, label: string, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const result = await read()
      if (accept(result))
        return result
    }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${label}`)
}

async function main() {
  assert.equal(process.env.ONEWEB_REAL_LOCAL_SERVICES, '1', 'Set ONEWEB_REAL_LOCAL_SERVICES=1 to opt into disposable Docker services')
  const prefix = `oneweb-la-${randomUUID().slice(0, 8)}`
  const network = `${prefix}-net`
  const containers: string[] = []
  const results: Array<Record<string, unknown>> = []
  const relays: Array<ReturnType<typeof createServer>> = []
  const resourceHost = 'resource.oneweb.test'
  let networkCreated = false
  try {
    docker('network', 'create', '--internal', '--label', 'oneweb.acceptance=local-20261115', network)
    networkCreated = true
    const resource = `${prefix}-resource`
    containers.push(resource)
    docker('run', '-d', '--name', resource, '--network', network, '--network-alias', resourceHost, '--label', 'oneweb.acceptance=local-20261115', 'node:24-bookworm-slim', 'node', '-e', `
      const http=require('node:http');
      http.createServer((req,res)=>{
        if(!['/fast.bin','/slow.bin'].includes(new URL(req.url,'http://fixture').pathname)){res.writeHead(404).end();return;}
        const slow=req.url.startsWith('/slow.bin'),size=slow?8*1024*1024:16384;
        res.writeHead(200,{'content-type':'application/octet-stream','content-length':size});
        if(req.method==='HEAD'){res.end();return;}
        if(!slow){res.end(Buffer.alloc(size,42));return;}
        let sent=0;const timer=setInterval(()=>{if(sent>=size){clearInterval(timer);res.end();return;}const block=Buffer.alloc(Math.min(32768,size-sent),24);sent+=block.length;res.write(block);},150);
        res.on('close',()=>clearInterval(timer));
      }).listen(8080,'0.0.0.0');
    `)
    for (const definition of images) {
      const container = `${prefix}-${definition.kind}`
      containers.push(container)
      const binary = `${definition.root}/${definition.kind}`
      docker('run', '-d', '--name', container, '--network', network, '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', `${definition.root}/data:rw,uid=1000,gid=1000,mode=0700`, '--entrypoint', binary, '--label', 'oneweb.acceptance=local-20261115', definition.image, 'server', '--no-prefix')
      const address = docker('inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', container)
      assert.match(address, /^\d+\.\d+\.\d+\.\d+$/u)
      // Docker's internal network denies published ports. This fixture-only loopback relay
      // exposes just one owned service while its downloader keeps zero external egress.
      const relay = createServer((incoming, outgoing) => {
        const upstream = httpRequest(`http://${address}:5244${incoming.url}`, {
          method: incoming.method,
          headers: incoming.headers,
        }, (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers)
          response.pipe(outgoing)
        })
        upstream.on('error', () => outgoing.writeHead(502).end())
        outgoing.on('close', () => upstream.destroy())
        incoming.pipe(upstream)
      })
      relays.push(relay)
      await new Promise<void>(resolve => relay.listen(0, '127.0.0.1', resolve))
      const origin = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`
      await until(async () => (await fetch(`${origin}/api/public/settings`)).status, status => status === 200, `${definition.kind} startup`)
      const version = docker('exec', container, binary, 'version')
      assert.ok(version.includes(definition.version) && version.includes(definition.commit), 'Pinned service version/commit mismatch')
      // Bootstrap output is captured in memory only: never echo an upstream admin token or log.
      const tokenCommand = spawnSync('docker', ['exec', container, binary, 'admin', 'token'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      })
      assert.equal(tokenCommand.status, 0, 'Disposable token command failed')
      const tokenOutput = stripVTControlCharacters(`${tokenCommand.stdout}\n${tokenCommand.stderr}`)
      const adminToken = /token(?: is)?\s*[:：]\s*(\S+)/iu.exec(tokenOutput)?.[1]
      assert.ok(adminToken && adminToken.length >= 20, `${definition.kind} disposable admin token unavailable`)
      const profileId = `local-${definition.kind}`
      const bootstrap = async (endpoint: string, body?: unknown, token = adminToken) => {
        const response = await fetch(`${origin}${endpoint}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'authorization': token!, 'client-id': clientId(profileId, origin), 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        })
        const envelope = await response.json() as { code: number, data: any, message?: string }
        if (envelope.code !== 200)
          throw new Error(`${definition.kind} bootstrap ${endpoint} code ${envelope.code}`)
        return envelope.data
      }
      docker('exec', container, 'mkdir', '-p', `${definition.root}/data/inbox`)
      await bootstrap('/api/admin/storage/create', {
        mount_path: '/inbox',
        driver: 'Local',
        order: 0,
        cache_expiration: 0,
        addition: JSON.stringify({ root_folder_path: `${definition.root}/data/inbox`, show_hidden: true, mkdir_perm: '0755' }),
      })
      const password = randomUUID()
      let role: number | number[] = 0
      if (definition.kind === 'alist') {
        await bootstrap('/api/admin/role/create', {
          name: 'oneweb-acceptance-role',
          permission_scopes: [{ path: '/inbox', permission: 12 }],
        })
        const roles = await bootstrap('/api/admin/role/list')
        const created = roles.content.find((entry: { name: string }) => entry.name === 'oneweb-acceptance-role')
        assert.ok(Number.isSafeInteger(created?.id), 'Disposable AList role missing')
        role = [created.id]
      }
      await bootstrap('/api/admin/user/create', { username: 'oneweb-acceptance', password, role, base_path: '/inbox', permission: 12 })
      const login = await bootstrap('/api/auth/login', { username: 'oneweb-acceptance', password }, '')
      assert.equal(typeof login.token, 'string')
      const token: string = login.token
      const connector = new SendToOpenListConnector({ fetch: async (input, init) => {
        const response = await fetch(input, init)
        const body = await response.clone().json() as { code?: number, data?: { tasks?: unknown } }
        const data = body.data
        process.stdout.write(`${definition.kind} ${new URL(String(input)).pathname}: ${JSON.stringify({
          http: response.status,
          code: body.code,
          dataType: Array.isArray(data) ? 'array' : typeof data,
          keys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : undefined,
          tasksType: data && typeof data === 'object' && 'tasks' in data ? (Array.isArray(data.tasks) ? 'array' : data.tasks === null ? 'null' : typeof data.tasks) : undefined,
          taskShapes: Array.isArray(data) && data[0] && typeof data[0] === 'object'
            ? data.map(task => ({
              state: task.state,
              progress: task.progress,
              totalBytes: task.total_bytes,
              text: Object.fromEntries(['id', 'name', 'status', 'error'].map((key) => {
                const value = task[key]
                return [key, { type: typeof value, length: typeof value === 'string' ? value.length : null, controls: typeof value === 'string' ? [...value].filter(character => character.charCodeAt(0) < 32).length : null }]
              })),
            }))
            : undefined,
        })}\n`)
        return response
      } })
      assert.deepEqual(await connector.verify(origin, profileId, token), { authenticated: true })
      const tools = await connector.discoverTools(origin, profileId, '/')
      assert.ok(tools.includes('SimpleHttp'), 'Pinned server has no ready SimpleHttp tool')
      await assert.rejects(connector.verify(origin, profileId, 'INVALID-LOCAL-FIXTURE'), error => error instanceof SendToOpenListConnectorError && error.code === 'authentication-failed')
      const started = performance.now()
      const fastId = await connector.addResource(origin, profileId, token, {
        url: `http://${resourceHost}:8080/fast.bin?signature=a%2Bb&x=1&x=2`,
        destinationPath: '/',
        tool: tools.find(tool => tool === 'SimpleHttp')!,
      })
      await until(async () => docker('exec', container, 'sh', '-c', `test -f ${definition.root}/data/inbox/fast.bin && wc -c < ${definition.root}/data/inbox/fast.bin`), value => Number(value) === 16384, `${definition.kind} real download`)
      const fastMs = Math.round(performance.now() - started)
      const slowId = await connector.addResource(origin, profileId, token, {
        url: `http://${resourceHost}:8080/slow.bin`,
        destinationPath: '/',
        tool: 'SimpleHttp',
      })
      const undone = await connector.listTasks(origin, profileId, token, 'undone')
      assert.ok(slowId && undone.some(task => task.id === slowId), 'Real slow download was not visible in unfinished task authority')
      assert.deepEqual(await connector.cancelTask(origin, profileId, token, slowId), { cancelled: true })
      await until(() => connector.listTasks(origin, profileId, token, 'undone'), tasks => !tasks.some(task => task.id === slowId), `${definition.kind} reviewed task cancellation`)
      const done = await connector.listTasks(origin, profileId, token, 'done')
      assert.deepEqual(await connector.verify(origin, profileId, token), { authenticated: true })
      results.push({ kind: definition.kind, image: definition.image, version: definition.version, commit: definition.commit, accountPermissions: 12, accountBasePath: '/inbox', tools, fastAccepted: true, fastHasTaskId: fastId !== null, downloadedBytes: 16384, fastDownloadMs: fastMs, unfinishedTaskVisible: true, cancellationVerified: true, doneCount: done.length, invalidTokenRejected: true, secretRecorded: false, externalEgress: false })
      process.stdout.write(`${definition.kind}: fixed connector authentication/tools/download/task cancellation passed\n`)
    }
  }
  finally {
    for (const relay of relays) {
      relay.closeAllConnections()
      await new Promise<void>(resolve => relay.close(() => resolve()))
    }
    for (const container of containers.reverse()) {
      try {
        docker('rm', '-f', '-v', container)
      }
      catch { /* A container whose creation failed may not exist. */ }
    }
    if (networkCreated)
      docker('network', 'rm', network)
  }
  const output = path.resolve('artifacts/local-acceptance/20261115/openlist-services.json')
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, JSON.stringify({ results, cleanup: 'all owned containers/anonymous volumes/internal network removed', boundary: 'real server/connector compatibility; browser permission and UI lifecycle are separate production E2E' }, null, 2))
  process.stdout.write('Real local OpenList/AList compatibility: 2/2 passed; disposable resources removed\n')
}

main().catch((error) => {
  // Do not serialize child-process errors: stdout/stderr can include bootstrap secrets.
  const message = error instanceof Error ? error.message : 'Local service acceptance failed'
  process.stderr.write(`${message.split('\n')[0]}\n`)
  process.exitCode = 1
})
