# claude-desktop-mods

Mods para Claude Code y Claude Desktop en Windows con WSL. Cada uno dibuja una
barra arriba del prompt, y juntos se ven así:

```
🐳 Docker · 3 corriendo · mi-app: api, db, redis        detalles
💻 CPU 14% ▂▃▅▃▂ · RAM 6.7/7.2 GB · WSL 1.1 GB · C: 313 GB libres
```

| Mod | Qué muestra | Comando |
| --- | --- | --- |
| [docker-wsl](docker-wsl) | Cuántos y cuáles contenedores Docker corren en WSL, con su estado, puertos, CPU y RAM | `/docker` |
| [rendimiento](rendimiento) | El CPU con una minigráfica del último minuto, la RAM, la RAM que ocupa WSL y el espacio libre en C: | `/rendimiento` |

Funcionan en las sesiones locales de Windows y en las conectadas a WSL. No
encienden WSL si está apagado y solo leen: nunca arrancan ni detienen nada.

**Requisitos:** Windows con WSL 2 y Docker instalado dentro de la distro (no hace
falta Docker Desktop). Claude Code 2.1.295 o más reciente: la API de mods es de
acceso anticipado y puede cambiar entre versiones.

## Instalación

### Desde este repositorio, como marketplace

En una sesión de Claude Code en la terminal (en la pestaña Code de Claude Desktop
este comando no está disponible):

```
/plugin install docker-wsl --marketplace amalitica/claude-desktop-mods
/plugin install rendimiento --marketplace amalitica/claude-desktop-mods
```

Responde `y` para agregar el marketplace y elige el alcance de usuario. Quedan
activos también en las sesiones locales de Claude Desktop.

Las sesiones de Claude Desktop conectadas a WSL usan la configuración de Claude
dentro de la distro: repite la instalación en una terminal de Claude en WSL.

### Desde una copia local

Clona el repositorio y agrega la carpeta de cada mod a la variable
`CLAUDE_CODE_PLUGIN_DIRS`, en el bloque `env` de tu `settings.json`:

- Windows, `%USERPROFILE%\.claude\settings.json`, con las rutas separadas por `;`:

  ```json
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\ruta\\al\\repo\\docker-wsl;C:\\ruta\\al\\repo\\rendimiento"
  }
  ```

- Dentro de WSL, `~/.claude/settings.json`, con las rutas separadas por `:` y
  apuntando a la misma copia vista desde Linux:

  ```json
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/mnt/c/ruta/al/repo/docker-wsl:/mnt/c/ruta/al/repo/rendimiento"
  }
  ```

Las sesiones que arranquen después cargan los mods. Para quitarlos, borra esas
rutas. No combines las dos formas de instalación: si un mod llega dos veces,
Claude carga solo una copia.

## Pruebas

```
claude plugin validate docker-wsl
claude plugin test docker-wsl
claude plugin validate rendimiento
claude plugin test rendimiento
```

Las pruebas simulan Docker y PowerShell, así que corren en cualquier máquina.
