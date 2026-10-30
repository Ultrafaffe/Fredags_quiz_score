# Minimal statisk server for lokal testning (PowerShell/.NET HttpListener).
# Kor: powershell -ExecutionPolicy Bypass -File serve.ps1
# Oppna sedan http://localhost:8123/ i webblasaren.
# Tips: oppna INTE index.html direkt (file://) - da fungerar varken API:t eller QR-koden.
param([int]$Port = 8123)

$root = (Split-Path -Parent $MyInvocation.MyCommand.Path)
$rootFull = [System.IO.Path]::GetFullPath($root)

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".ico"  = "image/x-icon"
  ".txt"  = "text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")

try {
  $listener.Start()
} catch {
  Write-Output "Kunde inte starta pa port $Port. Prova en annan port, t.ex.:"
  Write-Output "  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8124"
  exit 1
}

Write-Output "Server igang: http://localhost:$Port/"
Write-Output "Stoppa med Ctrl+C."

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = $ctx.Request.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }

    $path = [System.IO.Path]::GetFullPath((Join-Path $rootFull ($rel -replace '/', '\')))

    # Hindra att man nar filer utanfor mappen
    if (-not $path.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      $ctx.Response.StatusCode = 403
      $ctx.Response.Close()
      continue
    }

    if (Test-Path -LiteralPath $path -PathType Container) { $path = Join-Path $path "index.html" }

    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" }
      $ctx.Response.ContentLength64 = $bytes.Length
      # Aldrig cache - annars ser man gamla filer efter en andring
      $ctx.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
      $ctx.Response.Headers["Pragma"] = "no-cache"
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 - hittades inte")
      $ctx.Response.StatusCode = 404
      $ctx.Response.ContentType = "text/plain; charset=utf-8"
      $ctx.Response.ContentLength64 = $msg.Length
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.Close()
  } catch {
    Write-Output "Fel: $_"
  }
}
