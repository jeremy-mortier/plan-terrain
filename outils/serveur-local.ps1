# Petit serveur web local pour tester l'application sur ce PC : http://localhost:8080
# Lancement : pwsh -NoProfile -File outils/serveur-local.ps1
param([int]$Port = 8080)
$racine = Split-Path -Parent $PSScriptRoot
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json'; '.svg'='image/svg+xml'; '.png'='image/png'; '.ico'='image/x-icon'; '.webmanifest'='application/manifest+json' }
$l = [System.Net.HttpListener]::new()
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Serveur prêt : http://localhost:$Port/  (Ctrl+C pour arrêter)"
while ($l.IsListening) {
  $c = $l.GetContext()
  $chemin = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if (-not $chemin) { $chemin = 'index.html' }
  $f = [IO.Path]::GetFullPath((Join-Path $racine $chemin))
  if ($f.StartsWith($racine) -and (Test-Path $f -PathType Leaf)) {
    $o = [IO.File]::ReadAllBytes($f)
    $c.Response.ContentType = $types[[IO.Path]::GetExtension($f)] ?? 'application/octet-stream'
    $c.Response.Headers.Add('Cache-Control', 'no-store')
    $c.Response.OutputStream.Write($o, 0, $o.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
