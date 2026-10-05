$ErrorActionPreference = "Stop"

# Use the API Gateway invoke URL. Do not add a trailing slash.
$api = "https://cmsp9si3j7.execute-api.eu-north-1.amazonaws.com"

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Uri,
        [object]$Body = $null
    )

    try {
        $params = @{
            Method  = $Method
            Uri     = $Uri
            Headers = @{
                Accept = "application/json"
            }
        }

        if ($null -ne $Body) {
            $params.ContentType = "application/json"
            $params.Body = ($Body | ConvertTo-Json -Compress)
        }

        return Invoke-RestMethod @params
    }
    catch {
        Write-Host "Request failed: $Method $Uri" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        throw
    }
}

Write-Host "Testing POST /games..." -ForegroundColor Cyan

$game = Invoke-Api `
    -Method "POST" `
    -Uri "$api/games" `
    -Body @{
        questionCount       = 10
        answerCount         = 4
        answerDesign        = "letters"
        eliminationQuestion = $true
    }

if ([string]::IsNullOrWhiteSpace($game.gameId)) {
    throw "POST response did not contain gameId."
}

if ($game.eliminationQuestion -ne $true) {
    throw "POST response did not contain eliminationQuestion=true. Deploy the updated Lambda code."
}

Write-Host "Created game: $($game.gameId)" -ForegroundColor Green

Write-Host "Testing GET /games/{gameId}..." -ForegroundColor Cyan

$gameId = [uri]::EscapeDataString([string]$game.gameId)

$loadedGame = Invoke-Api `
    -Method "GET" `
    -Uri "$api/games/$gameId"

if ($loadedGame.gameId -ne $game.gameId) {
    throw "GET returned a different game."
}

if ($loadedGame.eliminationQuestion -ne $true) {
    throw "GET response did not contain eliminationQuestion=true. Check that Lambda stores and returns the setting."
}

Write-Host "Loaded game: $($loadedGame.gameId)" -ForegroundColor Green
Write-Host "Status: $($loadedGame.status)" -ForegroundColor Green
Write-Host "Question count: $($loadedGame.questionCount)" -ForegroundColor Green

Write-Host "Testing POST /games/{gameId}/scores..." -ForegroundColor Cyan

$scoreResponse = Invoke-Api `
    -Method "POST" `
    -Uri "$api/games/$gameId/scores" `
    -Body @{
        playerId = "test-player"
        name     = "Test Player"
        score    = 8
    }

if ($null -eq $scoreResponse) {
    throw "Score submission returned an empty response."
}

Write-Host "Score submitted for Test Player: 8" -ForegroundColor Green
Write-Host ""
Write-Host "All API tests passed." -ForegroundColor Green