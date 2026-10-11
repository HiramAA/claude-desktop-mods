import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

const PS = [
  '["a1b2c3d4e5f6","mi-app-api-1","mi-app-api","running","Up 19 minutes","127.0.0.1:8000->8000/tcp","mi-app","api"]',
  '["b2c3d4e5f6a7","mi-app-db-1","postgres:16-alpine","running","Up 52 minutes (healthy)","127.0.0.1:5432->5432/tcp","mi-app","db"]',
  '["c3d4e5f6a7b8","mi-app-redis-1","redis:7-alpine","running","Up 52 minutes (healthy)","127.0.0.1:6379->6379/tcp, [::]:6379->6379/tcp","mi-app","redis"]',
  '',
].join('\n')

const STATS = [
  '["a1b2c3d4e5f6","0.68%","88.43MiB / 2.84GiB"]',
  '["b2c3d4e5f6a7","1.33%","125.6MiB / 2.84GiB"]',
  '["c3d4e5f6a7b8","0.61%","11.46MiB / 2.84GiB"]',
  '',
].join('\n')

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const exited = (exitCode: number, stdout: string, stderr = ''): ProcessRunResult => ({
  exitCode,
  stdout,
  stderr,
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

type Machine = {
  isWslRunning?: boolean
  ps?: () => ProcessRunResult
  /** A reason every command fails to run with, as the host refusing it. */
  fail?: () => string | undefined
}

// This machine as the mod sees it: Docker inside WSL's Ubuntu, reached from
// Windows through wsl.exe or, in a session connected to WSL, directly.
// Answers the session's start beneath the mod, and records every command run.
function machine(
  on: On,
  { isWslRunning = true, ps = () => exited(0, PS), fail = () => undefined }: Machine = {},
) {
  const ran: string[][] = []
  const clock = mock.clock(on)
  mock.env(on, { WSL_DISTRO_NAME: 'Ubuntu' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    const reason = fail()
    if (reason !== undefined) {
      return { deny: reason }
    }
    const [bin, ...args] = e.argv
    const line = args.join(' ')
    if (bin === 'wsl.exe' && line === '--list --verbose') {
      const state = isWslRunning ? 'Running' : 'Stopped'
      return { value: exited(0, `  NAME      STATE           VERSION\n* Ubuntu    ${state}         2\n`) }
    }
    if (bin === 'wsl.exe' && line === '--list --running --quiet') {
      return { value: isWslRunning ? exited(0, 'Ubuntu\n') : exited(1, '') }
    }
    if (bin === 'docker' || (bin === 'wsl.exe' && args.includes('docker'))) {
      return { value: args.includes('stats') ? exited(0, STATS) : ps() }
    }
    return { deny: `unexpected command: ${e.argv.join(' ')}` }
  })
  engineBand(on)

  return { ran, clock }
}

const start = { cwd: '.', surface: 'desktop', isInteractive: false } as const

const DOCKER = {
  command: 'docker',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as const

// What the engine draws in the band when no plugin does.
function engineBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>the engine's own band</Text>
  })
}

describe('the band above the prompt', () => {
  test('is a Docker-blue bar on every surface that draws it', async ($, on) => {
    const { clock } = machine(on)
    await $.session.start(start)
    await clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'docker-wsl', surface, ...BAND })
      const boxes = await ui.findAll({ type: 'Box' })
      expect(boxes.some(box => box.props.backgroundColor === '#1D63ED')).toBe(true)
      expect(await ui.find({ type: 'Text', text: '🐳 Docker' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('counts the running containers and names them by compose project', async ($, on) => {
    const { clock } = machine(on)
    await $.session.start(start)
    await clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'docker-wsl', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: '3 corriendo' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'mi-app: api, db, redis' })).toBeDefined()
      expect((await ui.find({ key: 'toggle' }))?.text).toBe('detalles')
      await ui.unmount()
    }
  })

  test('detalles lists each container with its status and published ports', async ($, on) => {
    const { clock } = machine(on)
    await $.session.start(start)
    await clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'docker-wsl', surface, ...BAND })
      if ((await ui.find({ key: 'toggle' }))?.text === 'detalles') {
        await ui.press({ key: 'toggle' })
      }
      expect((await ui.find({ key: 'toggle' }))?.text).toBe('ocultar')
      expect(await ui.find({ type: 'Text', text: 'mi-app-db-1' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Up 52 minutes (healthy)' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ':6379' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '[::]' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('stacks on top of the bar beneath it instead of hiding it', async ($, on) => {
    const { clock } = machine(on)
    await $.session.start(start)
    await clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'docker-wsl', surface, ...BAND })
      const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
      const docker = texts.findIndex(text => text === '🐳 Docker')
      const beneath = texts.findIndex(text => text === "the engine's own band")
      expect(docker).toBeGreaterThan(-1)
      expect(beneath).toBeGreaterThan(docker)
      await ui.unmount()
    }
  })

  test('opening the details adds the CPU and memory of each container', async ($, on) => {
    const { clock } = machine(on)
    await $.session.start(start)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'docker-wsl', surface: 'desktop', ...BAND })
    await ui.press({ key: 'toggle' })
    await clock.advance(1_000)
    expect(await ui.find({ type: 'Text', text: 'CPU 1.33% · 125.6MiB' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2.84GiB' })).toBeUndefined()
  })

  test('says Docker does not answer when its daemon stays down', async ($, on) => {
    const down = exited(1, '', 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.')
    const { clock } = machine(on, { ps: () => down })
    await $.session.start(start)
    await clock.settle()
    await clock.advance(1_000)

    const ui = await $.ui.mount({ plugin: 'docker-wsl', surface: 'desktop', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'no responde' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Cannot connect to the Docker daemon' })).toBeDefined()
    expect(await ui.find({ key: 'toggle' })).toBeUndefined()
  })

  test('tries a single failed look again a second later and never shows it', async ($, on) => {
    let looks = 0
    const busy = exited(1, '', 'Wsl/Service/E_UNEXPECTED')
    const { clock } = machine(on, { ps: () => (++looks === 1 ? busy : exited(0, PS)) })
    await $.session.start(start)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'docker-wsl', surface: 'desktop', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'no responde' })).toBeUndefined()
    await clock.advance(1_000)
    expect(await ui.find({ type: 'Text', text: '3 corriendo' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'no responde' })).toBeUndefined()
  })

  test('polls again on its interval and shows a container that went away', async ($, on) => {
    let ps = exited(0, PS)
    const { clock } = machine(on, { ps: () => ps })
    await $.session.start(start)
    await clock.settle()
    ps = exited(0, PS.split('\n').slice(0, 2).join('\n'))
    await clock.advance(10_000)

    const ui = await $.ui.mount({ plugin: 'docker-wsl', surface: 'desktop', ...BAND })
    expect(await ui.find({ type: 'Text', text: '2 corriendo' })).toBeDefined()
  })
})

describe('/docker', () => {
  test('answers with one line per container, which Claude reads too', async ($, on) => {
    machine(on)
    await $.session.start(start)

    const { text } = await $.command.run(DOCKER)
    expect(text).toContain('Docker en Ubuntu: 3 contenedores corriendo')
    expect(text).toContain(
      '- mi-app-api-1 · mi-app-api · Up 19 minutes · 127.0.0.1:8000->8000/tcp · CPU 0.68% · RAM 88.43MiB',
    )
  })

  test('tries once more when WSL stumbles, then answers', async ($, on) => {
    let isBusy = true
    const { clock } = machine(on, { fail: () => (isBusy ? 'Wsl/Service/E_UNEXPECTED' : undefined) })
    await $.session.start(start)
    await clock.settle()

    const answer = $.command.run(DOCKER)
    await clock.settle()
    isBusy = false
    await clock.advance(1_000)
    const { text } = await answer
    expect(text).toContain('3 contenedores corriendo')
  })

  test('shows the real error when it persists, not "no Docker"', async ($, on) => {
    const { clock } = machine(on, { fail: () => 'Wsl/Service/E_UNEXPECTED' })
    await $.session.start(start)
    await clock.settle()

    const answer = $.command.run(DOCKER)
    await clock.settle()
    await clock.advance(1_000)
    const { text } = await answer
    expect(text).toContain('no responde')
    expect(text).toContain('Wsl/Service/E_UNEXPECTED')
    expect(text).not.toContain('No encontré Docker')
  })

  test('says there is no Docker only when the program does not exist', async ($, on) => {
    const { clock } = machine(on, { fail: () => 'spawn wsl.exe ENOENT' })
    await $.session.start(start)
    await clock.settle()

    const answer = $.command.run(DOCKER)
    await clock.settle()
    await clock.advance(1_000)
    const { text } = await answer
    expect(text).toContain('No encontré Docker')
    expect(text).toContain('ENOENT')
  })
})

describe('a session on Windows', () => {
  test('never starts WSL just to look at Docker', async ($, on) => {
    const { ran, clock } = machine(on, { isWslRunning: false })
    await $.session.start(start)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'docker-wsl', surface: 'desktop', ...BAND })
    const { text } = await $.command.run(DOCKER)
    const isWindows = ran[0]?.[0] === 'wsl.exe'
    if (isWindows) {
      expect(ran.some(argv => argv.includes('docker'))).toBe(false)
      expect(await ui.find({ type: 'Text', text: 'Docker' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: "the engine's own band" })).toBeDefined()
      expect(text).toContain('WSL (Ubuntu) está apagado')
    } else {
      // A session inside WSL runs where Docker is: nothing to start.
      expect(text).toContain('3 contenedores corriendo')
    }
  })
})
