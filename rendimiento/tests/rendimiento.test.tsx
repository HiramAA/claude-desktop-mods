import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { SAMPLER } from '../hooks/sampler'

// A reading this machine printed: 14 % CPU, 6.7 of 7.2 GB of RAM in use,
// 1.1 GB held by WSL, 313 GB free of 476 GB on C:.
const READING = {
  cpu: 14,
  ramTotal: 7772880896,
  ramAvail: 525848576,
  diskTotal: 510916554752,
  diskFree: 335814144000,
  wsl: 1231552512,
}
const line = (changes: Partial<typeof READING> = {}) => JSON.stringify({ ...READING, ...changes })

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const PERF = {
  command: 'rendimiento',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as const

const start = { cwd: '.', surface: 'desktop', isInteractive: false } as const

type Sampler = { lines?: string[]; fails?: boolean }

// The session beneath the mod: its sampler printing `lines` (or failing to
// start), what the engine draws above the prompt, and a clock the test moves.
function machine(on: On, { lines = [line()], fails = false }: Sampler = {}) {
  const spawned: string[][] = []
  const clock = mock.clock(on)
  mock.env(on, { WSL_DISTRO_NAME: 'Ubuntu' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.spawn', async function* ($, e) {
    spawned.push([...e.argv])
    if (fails) {
      return { deny: 'powershell.exe could not start' }
    }
    for (const text of lines) {
      yield { stream: 'stdout' as const, text: `${text}\r\n` }
    }

    return { value: { code: 0, signal: null } }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>the band above</Text>
  })

  return { spawned, clock }
}

// -EncodedCommand back to the script: base64 of UTF-16LE.
function decode(encoded: string): string {
  const binary = atob(encoded)
  let script = ''
  for (let i = 0; i < binary.length; i += 2) {
    script += String.fromCharCode(binary.charCodeAt(i) | (binary.charCodeAt(i + 1) << 8))
  }

  return script
}

describe('the performance bar', () => {
  test('shows CPU, RAM, WSL and free space on C: under the bar above it', async ($, on) => {
    const { clock } = machine(on)
    await $.session.start(start)
    await clock.settle()

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'rendimiento', surface, ...BAND })
      expect(await ui.find({ type: 'Text', text: '14% ▂' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '6.7/7.2 GB' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '1.1 GB' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '313 GB libres' })).toBeDefined()

      const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
      const above = texts.findIndex(text => text === 'the band above')
      const cpu = texts.findIndex(text => text === '14% ▂')
      expect(above).toBeGreaterThan(-1)
      expect(cpu).toBeGreaterThan(above)
      await ui.unmount()
    }
  })

  test('paints in red what runs short: RAM at 93 %', async ($, on) => {
    const { clock } = machine(on)
    await $.session.start(start)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'rendimiento', surface: 'desktop', ...BAND })
    // The Text drawing exactly this, not the line around it.
    const colorOf = async (text: string) =>
      (await ui.findAll({ type: 'Text', text })).find(one => one.text === text)?.props.color
    expect(await colorOf('6.7/7.2 GB')).toBe('error')
    expect(await colorOf('14% ▂')).toBe('text')
    expect(await colorOf('313 GB libres')).toBe('text')
  })

  test('draws the last minute of CPU as bars, each the busier of two readings', async ($, on) => {
    const lines = [line({ cpu: 0 }), line({ cpu: 100 }), line({ cpu: 50 }), line({ cpu: 25 })]
    const { clock } = machine(on, { lines })
    await $.session.start(start)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'rendimiento', surface: 'desktop', ...BAND })
    expect(await ui.find({ type: 'Text', text: '25% █▅' })).toBeDefined()
  })

  test('shows nothing of its own until the first reading', async ($, on) => {
    const { clock } = machine(on, { lines: [] })
    await $.session.start(start)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'rendimiento', surface: 'desktop', ...BAND })
    expect(await ui.find({ type: 'Text', text: 'the band above' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '💻' })).toBeUndefined()
  })
})

describe('the sampler', () => {
  test('is one PowerShell running the script encoded, so no quote breaks it', async ($, on) => {
    const { spawned, clock } = machine(on)
    await $.session.start(start)
    await clock.settle()

    expect(spawned).toHaveLength(1)
    const argv = spawned[0] ?? []
    expect(argv[0]).toBe('powershell.exe')
    expect(argv).toContain('-EncodedCommand')
    expect(decode(argv[argv.length - 1] ?? '')).toBe(SAMPLER)
  })

  test('starts again when it stops, and gives up after five failed starts', async ($, on) => {
    const { spawned, clock } = machine(on, { fails: true })
    await $.session.start(start)
    await clock.settle()
    for (let i = 0; i < 8; i += 1) {
      await clock.advance(5_000)
    }

    expect(spawned).toHaveLength(5)
    const { text } = await $.command.run(PERF)
    expect(text).toContain('No pude medir la computadora')
    expect(text).toContain('powershell.exe could not start')
  })
})

describe('/rendimiento', () => {
  test('answers with the last reading, which Claude reads too', async ($, on) => {
    const { clock } = machine(on)
    await $.session.start(start)
    await clock.settle()

    const { text } = await $.command.run(PERF)
    expect(text).toContain('CPU: 14 % ahora')
    expect(text).toContain('RAM: 6.7 de 7.2 GB en uso (93 %)')
    expect(text).toContain('WSL: 1.1 GB de RAM')
    expect(text).toContain('C: 313 GB libres de 476 GB')
  })
})
