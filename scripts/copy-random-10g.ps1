$ErrorActionPreference = 'Continue'
$base = 'G:\.shortcut-targets-by-id\1KolasQqQuQc7GNxnvijbJVYm-W8KIFMj\Masterview\Doc\2026'
$checker = 'C:\Users\andre\OneDrive\Desktop\Masterview\Proyectos\Checker'
$destRoot = Join-Path $checker 'random-10g'

$weeks = Get-ChildItem -LiteralPath $base -Directory | Where-Object { $_.Name -match '^(Semana|SEMANA)\s+\d+' }
$cocoa = @()
foreach ($week in $weeks) {
  $mvs = Get-ChildItem -LiteralPath $week.FullName -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^MV\s+\d+\s+.+' }
  foreach ($mv in $mvs) {
    $shippers = Get-ChildItem -LiteralPath $mv.FullName -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^Shipper\s+\d+\s+.+' }
    foreach ($shipper in $shippers) {
      $bookings = Get-ChildItem -LiteralPath $shipper.FullName -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^Booking\s+\d+\s+.+' }
      foreach ($bk in $bookings) {
        $bkn = ($bk.Name -replace '^Booking\s+\d+\s+', '').Trim().ToUpper()
        $profDir = Join-Path $bk.FullName '3 Proforma'
        $hblDir = Join-Path $bk.FullName '4 BL MASTERVIEW'
        if (-not (Test-Path -LiteralPath $profDir)) { continue }
        if (-not (Test-Path -LiteralPath $hblDir)) { continue }
        $prof = Get-ChildItem -LiteralPath $profDir -File -ErrorAction SilentlyContinue |
          Where-Object { $_.Extension -match '^\.xlsx?$' -and $_.Name -notmatch '^~\$' -and $_.Name -notmatch 'SUDESPENSA|FLETADO|PROFORMA BL' } |
          Select-Object -First 1
        $hbl = Get-ChildItem -LiteralPath $hblDir -File -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -match 'HBL DRAFT' -and $_.Extension -eq '.pdf' -and $_.Name -notmatch '^~\$|FLETADO' } |
          Select-Object -First 1
        if (-not $hbl) {
          $hbl = Get-ChildItem -LiteralPath $hblDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match 'HBL' -and $_.Extension -eq '.pdf' -and $_.Name -notmatch '^~\$|FLETADO' } |
            Select-Object -First 1
        }
        if (-not ($prof -and $hbl)) { continue }
        $cocoa += [pscustomobject]@{
          Week = $week.Name; MV = $mv.Name; Shipper = $shipper.Name; Booking = $bk.Name
          BookingNo = $bkn; Prof = $prof.FullName; Hbl = $hbl.FullName
        }
      }
    }
  }
}

Write-Host "COCOA PAIRS:" $cocoa.Count
$pick = @($cocoa | Get-Random -Count ([Math]::Min(10, $cocoa.Count)))
if (Test-Path -LiteralPath $destRoot) { Remove-Item -LiteralPath $destRoot -Recurse -Force }
New-Item -ItemType Directory -Path $destRoot | Out-Null
$i = 1
foreach ($p in $pick) {
  $slug = '{0:D2}-{1}' -f $i, ($p.BookingNo.ToLower())
  $dir = Join-Path $destRoot $slug
  New-Item -ItemType Directory -Path $dir | Out-Null
  $ext = [IO.Path]::GetExtension($p.Prof)
  Copy-Item -LiteralPath $p.Prof -Destination (Join-Path $dir ("proforma" + $ext))
  Copy-Item -LiteralPath $p.Hbl -Destination (Join-Path $dir 'hbl-draft.pdf')
  @"
week=$($p.Week)
mv=$($p.MV)
shipper=$($p.Shipper)
booking=$($p.Booking)
proforma_src=$([IO.Path]::GetFileName($p.Prof))
hbl_src=$([IO.Path]::GetFileName($p.Hbl))
"@ | Set-Content -LiteralPath (Join-Path $dir 'source.txt') -Encoding UTF8
  Write-Host ("{0:D2} {1} | {2} | {3} | {4}" -f $i, $p.Week, $p.MV, $p.Shipper, $p.Booking)
  $i++
}
Write-Host "COPIED:" ($i - 1)
