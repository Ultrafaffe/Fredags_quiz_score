<#
.SYNOPSIS
  Laddar upp Fredagsquiz till S3 och invaliderar CloudFront-cache.

.DESCRIPTION
  HTML laddas upp med 'no-cache' (webbläsaren hämtar alltid senaste versionen)
  medan css/js får en kort cache-tid. Använd -MaxAgeDays 365 tillsammans med
  filnamnsfingeravtryck om du vill kräftig cache på assets.

.EXAMPLE
  .\deploy.ps1 -Bucket fredagsquiz-123456789012 -DistributionId E123ABC
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Bucket,

  [string]$DistributionId = "",

  [string]$Region = "eu-north-1",

  [string]$Profile = "",

  [ValidateRange(0, 365)]
  [int]$MaxAgeDays = 1,

  [switch]$NoSync,

  [switch]$Open
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

function Invoke-Aws {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AwsArgs)

  if ($Profile) {
    & aws --profile $Profile @AwsArgs
  } else {
    & aws @AwsArgs
  }

  if ($LASTEXITCODE -ne 0) {
    throw "aws $($AwsArgs -join ' ') misslyckades med kod $LASTEXITCODE"
  }
}

try {
  # --- 1. Förutsättningar -------------------------------------------------
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI saknas. Installera via https://aws.amazon.com/cli/ och logga in med 'aws configure'."
  }

  Write-Host "Kontrollerar inloggning..." -ForegroundColor Cyan
  Invoke-Aws s3api head-bucket --bucket $Bucket --region $Region | Out-Null
  Write-Host "  Inloggad, bucketen '$Bucket' finns." -ForegroundColor Green

  # --- 2. Ladda upp webbfilerna ------------------------------------------
  if (-not $NoSync) {
    # Bara webbfiler ska publiceras - inte README, aws-mappen eller .git
    $exclude = @(
      "--exclude", "aws/*",
      "--exclude", ".git/*",
      "--exclude", ".gitattributes",
      "--exclude", "README.md",
      "--exclude", "amplify.yml"
    )

    Write-Host "Laddar upp HTML (no-cache)..." -ForegroundColor Cyan
    Invoke-Aws s3 sync . "s3://$Bucket" `
      --delete `
      --region $Region `
      --content-type "text/html; charset=utf-8" `
      --cache-control "no-cache, no-store, must-revalidate" `
      --exclude "*" --include "*.html" @exclude

    Write-Host "Laddar upp assets ($MaxAgeDays dagars cache)..." -ForegroundColor Cyan
    Invoke-Aws s3 sync . "s3://$Bucket" `
      --region $Region `
      --cache-control "public, max-age=$(([int]$MaxAgeDays * 86400))" `
      --exclude "*" --include "*.css" --include "*.js" --include "*.svg" --include "*.png" --include "*.ico" @exclude

    # Säkerställ att index.html finns i roten
    Invoke-Aws s3api head-object --bucket $Bucket --key "index.html" --region $Region | Out-Null
    Write-Host "  Uppladdning klar." -ForegroundColor Green
  }

  # --- 3. Invalidera CloudFront -------------------------------------------
  if ($DistributionId) {
    Write-Host "Invaliderar CloudFront-cache..." -ForegroundColor Cyan
    $invalidation = Invoke-Aws cloudfront create-invalidation `
      --distribution-id $DistributionId `
      --paths "/*" `
      --query 'Invalidation.Id' `
      --output text
    Write-Host "  Invalidation: $invalidation" -ForegroundColor Green
  }
  else {
    Write-Host "Ingen -DistributionId angiven: hoppar över invalidation." -ForegroundColor Yellow
  }

  $url = Invoke-Aws cloudfront get-distribution `
      --id $DistributionId `
      --query 'Distribution.DomainName' `
      --output text 2>$null

  if ($url -and $DistributionId) {
    $site = "https://$url"
    Write-Host "Klar: $site" -ForegroundColor Green
    if ($Open) { Start-Process $site }
  }
}
finally {
  Pop-Location
}
