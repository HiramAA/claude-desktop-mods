import { atom, read, update } from 'claude-code'
import type { Color, Register } from 'claude-code'

import type { PerfReading, PerfSample } from '../types'
import { SAMPLER, encodeCommand } from './sampler'

const EMPTY: PerfReading = { last: null, cpuHistory: [], error: null }
const reading = atom({ plugin: 'rendimiento', key: 'reading' } as const, EMPTY)

// A minute of CPU at one reading every two seconds.
const HISTORY = 30
// A sampler that ended is started again after this long, five times at most
// in a row: one that keeps failing is left alone.
const RESTART_MS = 5_000
const MAX_STARTS = 5

const SAMPLER_ARGV = ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(SAMPLER)]

const BARS = '▁▂▃▄▅▆▇█'
const GIB = 1024 ** 3

const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path)

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// One printed line: a reading, or why the sampler could not read.
function parseLine(line: string): PerfSample | { error: string } | undefined {
  const value = parseJson(line)
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const fields = value as Record<string, unknown>
  if (typeof fields.error === 'string') {
    return { error: fields.error }
  }
  const { cpu, ramTotal, ramAvail, diskTotal, diskFree, wsl } = fields
  if (![cpu, ramTotal, ramAvail, diskTotal, diskFree, wsl].every(isCount)) {
    return undefined
  }

  return {
    cpu: Math.min(100, Math.max(0, cpu as number)),
    ramTotal: ramTotal as number,
    ramAvail: ramAvail as number,
    diskTotal: diskTotal as number,
    diskFree: diskFree as number,
    wsl: wsl as number,
  }
}

const gb = (bytes: number) => (bytes / GIB).toFixed(1)

const wholeGb = (bytes: number) => Math.round(bytes / GIB).toString()

const ramShare = (sample: PerfSample) =>
  sample.ramTotal === 0 ? 0 : (sample.ramTotal - sample.ramAvail) / sample.ramTotal

// The minute as fifteen bars, each the busier of two readings, so a spike shows.
function sparkline(history: readonly number[]): string {
  let bars = ''
  for (let i = 0; i < history.length; i += 2) {
    const busiest = Math.max(history[i] ?? 0, history[i + 1] ?? 0)
    bars += BARS[Math.min(BARS.length - 1, Math.floor(busiest / 12.5))] ?? ''
  }

  return bars
}

function cpuTone(cpu: number): Color {
  if (cpu >= 85) {
    return 'error'
  }

  return cpu >= 60 ? 'warning' : 'text'
}

function ramTone(share: number): Color {
  if (share >= 0.9) {
    return 'error'
  }

  return share >= 0.75 ? 'warning' : 'text'
}

function diskTone(sample: PerfSample): Color {
  const share = sample.diskTotal === 0 ? 1 : sample.diskFree / sample.diskTotal
  if (share < 0.1) {
    return 'error'
  }

  return share < 0.2 ? 'warning' : 'text'
}

function describe({ last, cpuHistory, error }: PerfReading): string {
  if (last === null) {
    return error === null
      ? 'Todavía no tengo una lectura: la primera llega unos segundos después de abrir la sesión.'
      : `No pude medir la computadora: ${error}`
  }
  const average = cpuHistory.length === 0 ? last.cpu : cpuHistory.reduce((sum, cpu) => sum + cpu, 0) / cpuHistory.length
  const used = last.ramTotal - last.ramAvail

  return [
    'Rendimiento de la computadora (Windows):',
    `- CPU: ${last.cpu} % ahora, ${Math.round(average)} % de promedio en el último minuto`,
    `- RAM: ${gb(used)} de ${gb(last.ramTotal)} GB en uso (${Math.round(ramShare(last) * 100)} %)`,
    `- WSL: ${last.wsl > 0 ? `${gb(last.wsl)} GB de RAM` : 'apagado'}`,
    `- C: ${wholeGb(last.diskFree)} GB libres de ${wholeGb(last.diskTotal)} GB`,
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rendimiento',
      description: 'Muestra el CPU, la RAM, la memoria de WSL y el disco C: de tu computadora',
    })
    const started = await next(e)

    // Windows is measured from a Windows session, and from WSL through its
    // interop; a Linux server has no Windows to measure.
    const isWindows = isWindowsPath($.plugin.root)
    const isWsl = !isWindows && (await $.env.get('WSL_DISTRO_NAME')) !== undefined
    if (!isWindows && !isWsl) {
      return started
    }

    let starts = 0
    const sample = async () => {
      starts += 1
      let pending = ''
      try {
        const sampler = $.process.spawn(isWsl ? { argv: SAMPLER_ARGV, cwd: '/mnt/c' } : { argv: SAMPLER_ARGV })
        for await (const piece of sampler) {
          if (piece.stream !== 'stdout') {
            continue
          }
          const lines = (pending + piece.text).split(/\r?\n/)
          pending = lines.pop() ?? ''
          for (const line of lines) {
            const found = parseLine(line)
            if (found === undefined) {
              continue
            }
            if ('error' in found) {
              await update($, reading, current => ({ ...current, error: found.error }))
              continue
            }
            // A sampler that reads is healthy: a later end starts it afresh.
            starts = 0
            await update($, reading, current => ({
              last: found,
              cpuHistory: [...current.cpuHistory, found.cpu].slice(-HISTORY),
              error: null,
            }))
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await update($, reading, current => ({ ...current, error: message }))
      }
      if (starts < MAX_STARTS) {
        $.clock.after(RESTART_MS, () => void sample())
      }
    }
    void sample()

    return started
  })

  on('command.run', { command: 'rendimiento' }, async $ => ({ text: describe(await read($, reading)) }))

  // The performance bar goes under whatever is above the prompt already
  // (the Docker bar), so the two stack instead of one hiding the other.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const beneath = await next(e)
    const { last, cpuHistory } = await read($, reading)
    if (last === null) {
      return beneath
    }
    const { Box, Text } = $.ui.resolve(e)
    const used = last.ramTotal - last.ramAvail

    return (
      <Box flexDirection="column">
        {beneath}
        <Box paddingX={1}>
          <Text wrap="truncate-end">
            <Text bold>💻</Text>
            <Text dimColor> CPU </Text>
            <Text color={cpuTone(last.cpu)}>{`${last.cpu}% ${sparkline(cpuHistory)}`}</Text>
            <Text dimColor> · RAM </Text>
            <Text color={ramTone(ramShare(last))}>{`${gb(used)}/${gb(last.ramTotal)} GB`}</Text>
            <Text dimColor>{last.wsl > 0 ? ' · WSL ' : ''}</Text>
            <Text>{last.wsl > 0 ? `${gb(last.wsl)} GB` : ''}</Text>
            <Text dimColor> · C: </Text>
            <Text color={diskTone(last)}>{`${wholeGb(last.diskFree)} GB libres`}</Text>
          </Text>
        </Box>
      </Box>
    )
  })
}
