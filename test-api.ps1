$ErrorActionPreference = "Stop"

# Use the API Gateway invoke URL. Do not add a trailing slash.
$api = "https://cmsp9si3j7.execute-api.eu-north-1.amazonaws.com"

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Uri,
        [object]$Body = $null,
        [hashtable]$Headers = @{}
    )

    try {
        $params = @{
            Method  = $Method
            Uri     = $Uri
            Headers = $Headers + @{
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

# Runs a request that must fail with a specific HTTP status code.
function Invoke-ApiExpectingStatus {
    param(
        [string]$Method,
        [string]$Uri,
        [object]$Body = $null,
        [hashtable]$Headers = @{},
        [int]$ExpectedStatus
    )

    $actual = 0

    try {
        $params = @{
            Method  = $Method
            Uri     = $Uri
            Headers = $Headers + @{
                Accept = "application/json"
            }
        }

        if ($null -ne $Body) {
            $params.ContentType = "application/json"
            $params.Body = ($Body | ConvertTo-Json -Compress)
        }

        Invoke-RestMethod @params | Out-Null
        $actual = 200
    }
    catch {
        try { $actual = [int]$_.Exception.Response.StatusCode } catch { $actual = -1 }
    }

    if ($actual -ne $ExpectedStatus) {
        throw "Expected HTTP $ExpectedStatus from $Method $Uri but got HTTP $actual."
    }

    Write-Host "OK: $Method $Uri returned HTTP $actual as expected" -ForegroundColor Green
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

if ([string]::IsNullOrWhiteSpace($game.hostToken)) {
    throw "POST response did not contain hostToken. Deploy the updated Lambda code (step 5)."
}

Write-Host "Created game: $($game.gameId)" -ForegroundColor Green
Write-Host "Host token received (not returned by any other route)" -ForegroundColor Green

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

if ($null -ne $loadedGame.hostToken) {
    throw "GET leaked hostToken. It must be stripped from every response except POST /games."
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

if ($null -ne $scoreResponse.hostToken) {
    throw "Score response leaked hostToken."
}

Write-Host "Score submitted for Test Player: 8" -ForegroundColor Green

Write-Host "Testing resubmission with the same playerId (expect overwrite, not duplicate)..." -ForegroundColor Cyan

$resubmitted = Invoke-Api `
    -Method "POST" `
    -Uri "$api/games/$gameId/scores" `
    -Body @{
        playerId = "test-player"
        name     = "Test Player"
        score    = 3
    }

$playersAfterResubmit = @($resubmitted.players)

if ($playersAfterResubmit.Count -ne 1) {
    throw "Expected exactly 1 player after resubmitting the same playerId, but got $($playersAfterResubmit.Count). Duplicates inflate the leaderboard and the 'N har skickat in' count."
}

if ([int]$playersAfterResubmit[0].score -ne 3) {
    throw "Expected the latest score (3) to win, but got $($playersAfterResubmit[0].score)."
}

$reloadedForPlayers = Invoke-Api `
    -Method "GET" `
    -Uri "$api/games/$gameId"

$playersFromGet = @($reloadedForPlayers.players)

if ($playersFromGet.Count -ne 1) {
    throw "GET returned $($playersFromGet.Count) players for one playerId."
}

if ([int]$playersFromGet[0].score -ne 3) {
    throw "GET returned score $($playersFromGet[0].score) instead of the latest submission (3)."
}

Write-Host "Resubmission overwrote the previous score (players.Count = 1, score = 3)" -ForegroundColor Green

Write-Host "Testing score above questionCount (expect 400)..." -ForegroundColor Cyan

Invoke-ApiExpectingStatus `
    -Method "POST" `
    -Uri "$api/games/$gameId/scores" `
    -Body @{
        playerId = "test-player"
        name     = "Test Player"
        score    = 11
    } `
    -ExpectedStatus 400

Write-Host "Testing POST /games validation (expect 400)..." -ForegroundColor Cyan

Invoke-ApiExpectingStatus `
    -Method "POST" `
    -Uri "$api/games" `
    -Body @{ questionCount = 0 } `
    -ExpectedStatus 400

Invoke-ApiExpectingStatus `
    -Method "POST" `
    -Uri "$api/games" `
    -Body @{ questionCount = 1000000000 } `
    -ExpectedStatus 400

Invoke-ApiExpectingStatus `
    -Method "POST" `
    -Uri "$api/games" `
    -Body @{ questionCount = 10.5 } `
    -ExpectedStatus 400

Write-Host "Testing POST /games upper bound and hostName limit..." -ForegroundColor Cyan

$longHostName = [string]::new("V", 60)

$boundedGame = Invoke-Api `
    -Method "POST" `
    -Uri "$api/games" `
    -Body @{
        questionCount = 100
        hostName      = $longHostName
    }

if ([int]$boundedGame.questionCount -ne 100) {
    throw "questionCount=100 must be accepted (frontend MAX_COUNT is 100) but got $($boundedGame.questionCount)."
}

if ($boundedGame.hostName.Length -gt 40) {
    throw "hostName was not limited to 40 characters (got $($boundedGame.hostName.Length))."
}

Write-Host "questionCount=100 accepted, hostName limited to $($boundedGame.hostName.Length) characters" -ForegroundColor Green

Write-Host "Testing PATCH without host token (expect 403)..." -ForegroundColor Cyan

Invoke-ApiExpectingStatus `
    -Method "PATCH" `
    -Uri "$api/games/$gameId" `
    -Body @{ status = "inactive" } `
    -ExpectedStatus 403

Write-Host "Testing PATCH with host token (expect 200)..." -ForegroundColor Cyan

$endedGame = Invoke-Api `
    -Method "PATCH" `
    -Uri "$api/games/$gameId" `
    -Headers @{ "x-host-token" = $game.hostToken } `
    -Body @{ status = "inactive" }

if ($endedGame.status -ne "inactive") {
    throw "PATCH with host token did not end the game."
}

if ($null -ne $endedGame.hostToken) {
    throw "PATCH response leaked hostToken."
}

Write-Host "Game ended with host token" -ForegroundColor Green

$firstEndedAt = [string]$endedGame.endedAt

Write-Host "Testing PATCH again on the ended game (expect 200, unchanged endedAt)..." -ForegroundColor Cyan

$repeatPatch = Invoke-Api `
    -Method "PATCH" `
    -Uri "$api/games/$gameId" `
    -Headers @{ "x-host-token" = $game.hostToken } `
    -Body @{ status = "inactive" }

if ($repeatPatch.status -ne "inactive") {
    throw "A repeat PATCH must still report the game as inactive."
}

if ([string]$repeatPatch.endedAt -ne $firstEndedAt) {
    throw "endedAt changed on a repeat PATCH ($firstEndedAt -> $($repeatPatch.endedAt)). PATCH must be idempotent."
}

if ($null -ne $repeatPatch.hostToken) {
    throw "Repeat PATCH response leaked hostToken."
}

Write-Host "Repeat PATCH is idempotent (endedAt unchanged: $firstEndedAt)" -ForegroundColor Green

Write-Host "Testing GET after ending (expect status=inactive, no token)..." -ForegroundColor Cyan

$endedLoaded = Invoke-Api `
    -Method "GET" `
    -Uri "$api/games/$gameId"

if ($endedLoaded.status -ne "inactive") {
    throw "GET did not report the game as inactive."
}

if ($null -ne $endedLoaded.hostToken) {
    throw "GET leaked hostToken after the game ended."
}

Write-Host "Testing score submission to an ended game (expect 409)..." -ForegroundColor Cyan

Invoke-ApiExpectingStatus `
    -Method "POST" `
    -Uri "$api/games/$gameId/scores" `
    -Body @{
        playerId = "late-player"
        name     = "Late Player"
        score    = 9
    } `
    -ExpectedStatus 409

Write-Host ""
Write-Host "All API tests passed." -ForegroundColor Green
