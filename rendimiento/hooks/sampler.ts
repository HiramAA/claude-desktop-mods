// Reads the machine every two seconds and prints one JSON line per reading.
// One PowerShell stays open for the session: a reading costs it a few
// milliseconds, where starting PowerShell or asking WMI costs a second or more.
// CPU and memory come straight from kernel32, which no locale renames.
export const SAMPLER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PerfNative {
  [DllImport("kernel32.dll")]
  public static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
  [StructLayout(LayoutKind.Sequential)]
  public class MemoryStatus {
    public uint Length = 64; public uint Load;
    public ulong TotalPhys; public ulong AvailPhys;
    public ulong TotalPageFile; public ulong AvailPageFile;
    public ulong TotalVirtual; public ulong AvailVirtual; public ulong AvailExtendedVirtual;
  }
  [DllImport("kernel32.dll")]
  public static extern bool GlobalMemoryStatusEx([In, Out] MemoryStatus status);
}
'@
$idle = 0L; $kernel = 0L; $user = 0L
[void][PerfNative]::GetSystemTimes([ref]$idle, [ref]$kernel, [ref]$user)
while ($true) {
  Start-Sleep -Seconds 2
  try {
    $i = 0L; $k = 0L; $u = 0L
    [void][PerfNative]::GetSystemTimes([ref]$i, [ref]$k, [ref]$u)
    $total = ($k - $kernel) + ($u - $user)
    $cpu = 0
    if ($total -gt 0) { $cpu = [int][math]::Round(100 * ($total - ($i - $idle)) / $total) }
    $idle = $i; $kernel = $k; $user = $u
    $memory = New-Object PerfNative+MemoryStatus
    [void][PerfNative]::GlobalMemoryStatusEx($memory)
    $disk = New-Object IO.DriveInfo 'C'
    $wsl = 0L
    foreach ($p in [Diagnostics.Process]::GetProcessesByName('vmmemWSL')) { $wsl += $p.WorkingSet64 }
    $line = @{
      cpu = $cpu; ramTotal = $memory.TotalPhys; ramAvail = $memory.AvailPhys
      diskTotal = $disk.TotalSize; diskFree = $disk.AvailableFreeSpace; wsl = $wsl
    } | ConvertTo-Json -Compress
  } catch {
    $line = @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
  }
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}
`.replace(/\r?\n/g, '\r\n')

// PowerShell's -EncodedCommand: the script as UTF-16LE in base64, so no
// quote in it is reinterpreted on its way through a command line.
export function encodeCommand(script: string): string {
  let binary = ''
  for (let i = 0; i < script.length; i += 1) {
    const code = script.charCodeAt(i)
    binary += String.fromCharCode(code & 0xff, code >> 8)
  }

  return btoa(binary)
}
