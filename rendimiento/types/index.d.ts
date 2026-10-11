/** One reading of the machine, as the sampler prints it every two seconds. */
export type PerfSample = {
  /** CPU in use across every core, 0 to 100. */
  cpu: number
  /** Physical memory, in bytes. */
  ramTotal: number
  ramAvail: number
  /** Drive C:, in bytes. */
  diskTotal: number
  diskFree: number
  /** Memory the WSL virtual machine holds on Windows (vmmemWSL), 0 when off. */
  wsl: number
}

export type PerfReading = {
  /** The newest sample; null until the sampler's first. */
  last: PerfSample | null
  /** CPU over the last minute, oldest first, for the sparkline. */
  cpuHistory: number[]
  /** Why the sampler could not read, while it cannot; null when it reads. */
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    rendimiento: { reading: PerfReading }
  }
}
