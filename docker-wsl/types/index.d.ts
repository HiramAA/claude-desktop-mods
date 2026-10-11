/** One running container, as `docker ps` lists it. */
export type DockerContainer = {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
  /** The compose project and service, empty for a container run by hand. */
  project: string
  service: string
  /** What `docker stats` read ("1.33%", "125.6MiB"): empty until asked for. */
  cpu: string
  memory: string
}

/**
 * What the last look at Docker found: its containers, an error from Docker,
 * WSL switched off (never started just to look), or no Docker at all, with
 * the reason it was taken for absent.
 */
export type DockerSnapshot =
  | { kind: 'ok'; distro: string; containers: DockerContainer[] }
  | { kind: 'down'; distro: string; message: string }
  | { kind: 'off'; distro: string }
  | { kind: 'missing'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'docker-wsl': { snapshot: DockerSnapshot | null; isExpanded: boolean }
  }
}
