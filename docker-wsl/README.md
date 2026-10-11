# docker-wsl

Mod de Claude Code que muestra, en una barra azul arriba del prompt, cuántos y
cuáles contenedores Docker están corriendo en WSL.

```
🐳 Docker · 3 corriendo · mi-app: api, db, redis        detalles
```

- La barra usa el azul de Docker (`#1D63ED`) con texto blanco. Si Docker no
  responde, sigue azul y el aviso sale en ámbar con el error real.
- **detalles** despliega un renglón por contenedor: su estado (verde si está
  sano, rojo si no, amarillo si está arrancando), sus puertos publicados y su
  CPU y RAM.
- `/docker` pone la lista completa en la conversación, con CPU y RAM, y Claude
  también la lee.
- Se actualiza cada 10 segundos, y un segundo después de que Claude ejecute un
  comando `docker`.
- Si una consulta falla, la reintenta un segundo después antes de mostrar nada.
  "No encontré Docker" solo aparece si el programa de verdad no existe.
- Se apila encima de la barra de rendimiento (`rendimiento`); las dos conviven.

## Dónde corre

- **Sesión local (Windows):** consulta Docker con `wsl.exe`. Si WSL está
  apagado no lo enciende y la barra no aparece.
- **Sesión conectada a WSL:** llama a `docker` directamente.

Lo que ejecuta:

- Desde Windows, cada 10 segundos: `wsl.exe --list --running --quiet` y, solo si
  la distro está encendida, `wsl.exe --distribution <distro> --cd ~ --exec docker ps --format …`.
  Una vez por sesión, `wsl.exe --list --verbose` para saber cuál es la distro
  por defecto.
- Dentro de WSL, cada 10 segundos: `docker ps --format …`.
- Solo con los detalles abiertos, y en `/docker`: `docker stats --no-stream`, que
  tarda alrededor de un segundo y medio.

Nada más: solo lee, nunca arranca ni detiene contenedores.

## Instalación

Mira el [README del repositorio](../README.md).

## Pruebas

```
claude plugin validate <carpeta del mod>
claude plugin test <carpeta del mod>
```
