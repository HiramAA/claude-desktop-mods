import { atom, read, update } from 'claude-code'
import type { Color, ProcessRunInit, ProcessRunResult, Register } from 'claude-code'

import type { DockerContainer, DockerSnapshot } from '../types'

const snapshot = atom({ plugin: 'docker-wsl', key: 'snapshot' } as const, null)
const isExpanded = atom({ plugin: 'docker-wsl', key: 'isExpanded' } as const, false)

const POLL_MS = 10_000
const RETRY_MS = 1_000
const LIST_TIMEOUT_MS = 5_000
const DOCKER_TIMEOUT_MS = 8_000

// Docker's own blue for the bar, and what reads well on it in either theme.
const DOCKER_BLUE = '#1D63ED'
const ON_BLUE = '#FFFFFF'
const ON_BLUE_SOFT = '#C9DAFF'
const ON_BLUE_WARN = '#FFD166'

// One JSON array per container, so no name or status can break the parsing.
// Raw strings (backquotes) keep double quotes out of the argument wsl.exe gets.
const FORMAT = [
  '{{json .ID}}',
  '{{json .Names}}',
  '{{json .Image}}',
  '{{json .State}}',
  '{{json .Status}}',
  '{{json .Ports}}',
  '{{json (.Label `com.docker.compose.project`)}}',
  '{{json (.Label `com.docker.compose.service`)}}',
].join(',')
const DOCKER_PS = ['docker', 'ps', '--format', `[${FORMAT}]`]
// CPU and memory per container: a second and a half of sampling, so only
// asked for while the details are open, and by /docker.
const DOCKER_STATS = ['docker', 'stats', '--no-stream', '--format', '[{{json .ID}},{{json .CPUPerc}},{{json .MemUsage}}]']

// Without it wsl.exe answers in UTF-16.
const WSL_ENV = { WSL_UTF8: '1' }

/** What a look at Docker needs from the session, built by the hook asking. */
type Host = {
  isWindows: boolean
  run: (argv: readonly string[], init: ProcessRunInit) => Promise<ProcessRunResult>
  distroName: () => Promise<string | undefined>
}

const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path)

const clean = (text: string) => text.replace(/\u0000/g, '').replace(/^﻿/, '')

const lines = (text: string) => clean(text).split(/\r?\n/).map(line => line.trim())

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function parseContainer(line: string): DockerContainer | undefined {
  const fields = parseJson(line)
  if (!Array.isArray(fields)) {
    return undefined
  }
  const [id = '', name = '', image = '', state = '', status = '', ports = '', project = '', service = ''] =
    fields.map(field => (typeof field === 'string' ? field : ''))

  return id === '' ? undefined : { id, name, image, state, status, ports, project, service, cpu: '', memory: '' }
}

function fromRun(ran: ProcessRunResult, distro: string): DockerSnapshot {
  if (ran.exitCode !== 0) {
    const message = lines(ran.stderr || ran.stdout).find(line => line !== '') ?? ''
    // wsl.exe found no docker inside the distro.
    if (/execvpe?\(docker\)|docker: (command )?not found/i.test(message)) {
      return { kind: 'missing', reason: message }
    }

    return { kind: 'down', distro, message }
  }
  const containers = lines(ran.stdout)
    .map(parseContainer)
    .filter((one): one is DockerContainer => one !== undefined)

  return { kind: 'ok', distro, containers }
}

// The distro wsl.exe runs by default, read once: the line marked `*`.
let defaultDistro: string | undefined

// Runs a docker command where Docker is: inside the distro through wsl.exe
// from Windows, directly from a session inside WSL.
function runDocker(host: Host, distro: string, argv: readonly string[]): Promise<ProcessRunResult> {
  return host.isWindows
    ? host.run(['wsl.exe', '--distribution', distro, '--cd', '~', '--exec', ...argv], {
        env: WSL_ENV,
        timeoutMs: DOCKER_TIMEOUT_MS,
      })
    : host.run(argv, { timeoutMs: DOCKER_TIMEOUT_MS })
}

async function lookFromWindows(host: Host): Promise<DockerSnapshot> {
  if (defaultDistro === undefined) {
    const listed = await host.run(['wsl.exe', '--list', '--verbose'], {
      env: WSL_ENV,
      timeoutMs: LIST_TIMEOUT_MS,
    })
    defaultDistro = lines(listed.stdout).find(line => line.startsWith('*'))?.split(/\s+/)[1]
    if (defaultDistro === undefined) {
      // WSL answered something else (busy, no distro installed): say what.
      const said = lines(listed.stderr || listed.stdout).find(line => line !== '')

      return { kind: 'down', distro: '', message: said ?? `wsl.exe salió con ${listed.exitCode}` }
    }
  }
  const distro = defaultDistro

  // Listing what runs never starts WSL; running docker inside it would.
  const running = await host.run(['wsl.exe', '--list', '--running', '--quiet'], {
    env: WSL_ENV,
    timeoutMs: LIST_TIMEOUT_MS,
  })
  if (!lines(running.stdout).includes(distro)) {
    return { kind: 'off', distro }
  }

  return fromRun(await runDocker(host, distro, DOCKER_PS), distro)
}

async function lookFromLinux(host: Host): Promise<DockerSnapshot> {
  const distro = (await host.distroName()) ?? ''

  return fromRun(await runDocker(host, distro, DOCKER_PS), distro)
}

type Running = Extract<DockerSnapshot, { kind: 'ok' }>

// Each container's CPU and memory from docker stats ("125.6MiB / 2.84GiB"
// kept as "125.6MiB"); a look that cannot get them keeps what it had.
async function withUsage(host: Host, found: Running): Promise<Running> {
  try {
    const ran = await runDocker(host, found.distro, DOCKER_STATS)
    if (ran.exitCode !== 0) {
      return found
    }
    const usage = new Map<string, { cpu: string; memory: string }>()
    for (const line of lines(ran.stdout)) {
      const fields = parseJson(line)
      if (!Array.isArray(fields)) {
        continue
      }
      const [id = '', cpu = '', memory = ''] = fields.map(field => (typeof field === 'string' ? field : ''))
      usage.set(id, { cpu, memory: memory.split(' / ')[0] ?? '' })
    }

    return { ...found, containers: found.containers.map(one => ({ ...one, ...usage.get(one.id) })) }
  } catch {
    return found
  }
}

// A session on Windows reaches Docker through wsl.exe; one connected to WSL
// runs inside the distro and calls docker directly.
async function look(host: Host, withStats = false): Promise<DockerSnapshot> {
  try {
    const found = host.isWindows ? await lookFromWindows(host) : await lookFromLinux(host)

    return withStats && found.kind === 'ok' && found.containers.length > 0 ? await withUsage(host, found) : found
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Only a program that does not exist (no wsl.exe, no docker) means there
    // is no Docker here; any other failure is shown as it came.
    if (/ENOENT|not found/i.test(message)) {
      return { kind: 'missing', reason: message }
    }

    return { kind: 'down', distro: defaultDistro ?? '', message }
  }
}

// What was last written, so an unchanged look redraws nothing.
let written = ''

const isFailure = (found: DockerSnapshot) => found.kind === 'down' || found.kind === 'missing'

const running = (count: number) =>
  count === 0 ? 'ningún contenedor corriendo' : `${count} corriendo`

const where = (distro: string) => (distro === '' ? '' : ` en ${distro}`)

// "mi-app: api, db, redis · otro-contenedor"
function names(containers: readonly DockerContainer[]): string {
  const projects = new Map<string, Map<string, number>>()
  const loose: string[] = []
  for (const one of containers) {
    if (one.project === '' || one.service === '') {
      loose.push(one.name)
      continue
    }
    const services = projects.get(one.project) ?? new Map<string, number>()
    services.set(one.service, (services.get(one.service) ?? 0) + 1)
    projects.set(one.project, services)
  }
  const grouped = [...projects].map(([project, services]) => {
    const list = [...services].map(([service, n]) => (n > 1 ? `${service} ×${n}` : service))

    return `${project}: ${list.join(', ')}`
  })

  return [...grouped, ...loose].join(' · ')
}

// "127.0.0.1:8000->8000/tcp, [::]:8000->8000/tcp" -> ":8000"
function hostPorts(ports: string): string {
  const published = [...ports.matchAll(/:(\d+(?:-\d+)?)->/g)]
    .map(match => match[1])
    .filter((port): port is string => port !== undefined)

  return [...new Set(published)].map(port => `:${port}`).join(' ')
}

function tone(one: DockerContainer): Color {
  if (/unhealthy/i.test(one.status)) {
    return 'error'
  }
  if (one.state !== 'running' || /starting|paused/i.test(one.status)) {
    return 'warning'
  }

  return /healthy/i.test(one.status) ? 'success' : 'text'
}

function describe(found: DockerSnapshot): string {
  switch (found.kind) {
    case 'missing':
      return `No encontré Docker: ni \`docker\` en esta sesión ni una distro de WSL (${found.reason}).`
    case 'off':
      return `WSL (${found.distro}) está apagado, así que no hay contenedores corriendo. No lo enciendo solo para mirar.`
    case 'down':
      return `Docker${where(found.distro)} no responde: ${found.message}`
    case 'ok': {
      const count = found.containers.length
      if (count === 0) {
        return `Docker${where(found.distro)}: ningún contenedor corriendo.`
      }
      const rows = found.containers.map(one =>
        [
          one.name,
          one.image,
          one.status,
          one.ports,
          one.cpu === '' ? '' : `CPU ${one.cpu}`,
          one.memory === '' ? '' : `RAM ${one.memory}`,
        ]
          .filter(part => part !== '')
          .join(' · '),
      )

      return [
        `Docker${where(found.distro)}: ${count} ${count === 1 ? 'contenedor' : 'contenedores'} corriendo`,
        ...rows.map(row => `- ${row}`),
      ].join('\n')
    }
  }
}

export const register: Register = on => {
  let isLooking = false
  // Failed looks in a row: a single one is tried again before it is shown.
  let failures = 0
  // Set once the session started: looks again a second from now.
  let lookSoon: (() => void) | undefined

  on('session.start', async ($, e, next) => {
    // A new session holds no snapshot yet: the first look always writes.
    written = ''
    failures = 0
    await $.command.register({
      name: 'docker',
      description: 'Lista los contenedores Docker que están corriendo (WSL)',
    })
    const started = await next(e)

    const refresh = async () => {
      if (isLooking) {
        return
      }
      isLooking = true
      try {
        const host: Host = {
          isWindows: isWindowsPath($.plugin.root),
          run: (argv, init) => $.process.run(argv, init),
          distroName: () => $.env.get('WSL_DISTRO_NAME'),
        }
        const found = await look(host, await read($, isExpanded))
        failures = isFailure(found) ? failures + 1 : 0
        // WSL stumbles now and then (a session starting, the app using it at
        // the same moment): one failed look is tried again in a second.
        if (failures === 1) {
          $.clock.after(RETRY_MS, () => void refresh())
          return
        }
        const text = JSON.stringify(found)
        if (text !== written) {
          await update($, snapshot, () => found)
          written = text
        }
      } catch (error) {
        $.ui.log(`docker-wsl: ${String(error)}`, { to: 'debug' })
      } finally {
        isLooking = false
      }
    }
    lookSoon = () => {
      $.clock.after(1_000, () => void refresh())
    }
    void refresh()
    $.clock.every(POLL_MS, () => void refresh())

    return started
  })

  on('command.run', { command: 'docker' }, async $ => {
    const host: Host = {
      isWindows: isWindowsPath($.plugin.root),
      run: (argv, init) => $.process.run(argv, init),
      distroName: () => $.env.get('WSL_DISTRO_NAME'),
    }
    let found = await look(host, true)
    if (isFailure(found)) {
      await $.clock.sleep(RETRY_MS)
      found = await look(host, true)
    }
    const text = JSON.stringify(found)
    if (text !== written) {
      await update($, snapshot, () => found)
      written = text
    }

    return { text: describe(found) }
  })

  // Claude just ran docker (compose up, stop...): look again in a second
  // instead of waiting for the next poll.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bdocker\b/.test(String(e.command))) {
      lookSoon?.()
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const found = await read($, snapshot)
    if (e.props.hasSurvey || found === null || found.kind === 'off' || found.kind === 'missing') {
      return next(e)
    }
    // The Docker bar goes on top of whatever else is above the prompt (the
    // performance bar), so the two stack instead of one hiding the other.
    const beneath = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const brand = <Text bold>🐳 Docker</Text>

    if (found.kind === 'down') {
      return (
        <Box flexDirection="column">
          <Box backgroundColor={DOCKER_BLUE} paddingX={1}>
            <Text wrap="truncate-end" color={ON_BLUE}>
              {brand}
              <Text color={ON_BLUE_WARN}> · no responde</Text>
              <Text color={ON_BLUE_SOFT}>{found.message === '' ? '' : ` · ${found.message}`}</Text>
            </Text>
          </Box>
          {beneath}
        </Box>
      )
    }

    const { containers } = found
    const isOpen = containers.length > 0 && (await read($, isExpanded))
    // Opening the details asks for CPU and memory at once, not at the next poll.
    const toggle = () => {
      lookSoon?.()

      return update($, isExpanded, shown => !shown)
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} backgroundColor={DOCKER_BLUE} paddingX={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" color={ON_BLUE}>
              {brand}
              <Text color={containers.length > 0 ? ON_BLUE : ON_BLUE_SOFT}> · {running(containers.length)}</Text>
              {!isOpen && containers.length > 0 && <Text color={ON_BLUE_SOFT}> · {names(containers)}</Text>}
            </Text>
          </Box>
          {containers.length > 0 && (
            <Button key="toggle" plain onPress={toggle}>
              <Text color={ON_BLUE_SOFT}>{isOpen ? 'ocultar' : 'detalles'}</Text>
            </Button>
          )}
        </Box>
        {isOpen &&
          containers.map(one => (
            <Text wrap="truncate-end">
              {'  '}
              {one.name}
              <Text color={tone(one)}>{`  ${one.status}`}</Text>
              <Text dimColor>{one.ports === '' ? '' : `  ${hostPorts(one.ports)}`}</Text>
              <Text dimColor>{one.cpu === '' ? '' : `  CPU ${one.cpu} · ${one.memory}`}</Text>
            </Text>
          ))}
        {beneath}
      </Box>
    )
  })
}
