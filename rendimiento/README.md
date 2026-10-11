# rendimiento

Mod de Claude Code que muestra, en una barra arriba del prompt, cómo va tu
computadora:

```
💻 CPU 14% ▂▃▅▃▂ · RAM 6.7/7.2 GB · WSL 1.1 GB · C: 313 GB libres
```

- **CPU:** el uso actual y una minigráfica del último minuto. Cada barrita es la
  más alta de dos lecturas, para que un pico no se pierda.
- **RAM:** usada / total. Se pinta en amarillo desde 75 % y en rojo desde 90 %.
- **WSL:** la RAM que ocupa la máquina virtual de WSL en Windows (`vmmemWSL`).
  No aparece si WSL está apagado.
- **C::** el espacio libre. Amarillo con menos de 20 % libre, rojo con menos de 10 %.
- El CPU se pinta en amarillo desde 60 % y en rojo desde 85 %.
- `/rendimiento` pone las mismas cifras en la conversación, con el promedio de
  CPU del último minuto, y Claude también las lee.

Se apila debajo de la barra de Docker (`docker-wsl`); las dos conviven.

## Cómo mide

Un solo PowerShell por sesión, abierto mientras dure, que lee a Windows cada
2 segundos (`GetSystemTimes` y `GlobalMemoryStatusEx` de kernel32, `DriveInfo`
para C: y el proceso `vmmemWSL`). Arrancarlo cuesta alrededor de un segundo; cada
lectura después, unos milisegundos. No usa WMI: su primera consulta tardaba
9 segundos en esta máquina.

El script va como `-EncodedCommand`, así que las comillas no se rompen en el
camino. Si PowerShell se cierra, el mod lo vuelve a abrir a los 5 segundos,
hasta 5 veces seguidas. Al cerrar la sesión, Claude lo termina.

## Dónde corre

- **Sesión local (Windows):** mide Windows.
- **Sesión conectada a WSL:** también mide Windows, abriendo `powershell.exe` a
  través de la interoperabilidad de WSL.
- **Servidor Linux (SSH):** no hay Windows que medir, así que la barra no
  aparece.

## Instalación

Mira el [README del repositorio](../README.md).

## Pruebas

```
claude plugin validate <carpeta del mod>
claude plugin test <carpeta del mod>
```
