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

$quiz = @{
    title        = "Smoke test"
    timeLimitSec = 20
    scoring      = "speed"
    questions    = @(
        @{ text = "Huvudstad i Peru?"; options = @("Lima", "Quito", "La Paz"); correct = 0 },
        @{ text = "2 + 2?"; options = @("3", "4"); correct = 1 }
    )
}

Write-Host "Testing POST /games validation (expect 400)..." -ForegroundColor Cyan

Invoke-ApiExpectingStatus -Method "POST" -Uri "$api/games" -Body @{ quiz = @{ questions = @() } } -ExpectedStatus 400

$speedWithoutTimer = $quiz.Clone()
$speedWithoutTimer.timeLimitSec = 0
Invoke-ApiExpectingStatus -Method "POST" -Uri "$api/games" -Body @{ quiz = $speedWithoutTimer } -ExpectedStatus 400

Write-Host "Testing POST /games..." -ForegroundColor Cyan

$game = Invoke-Api -Method "POST" -Uri "$api/games" -Body @{ hostName = "Smoke"; quiz = $quiz }

if ([string]::IsNullOrWhiteSpace($game.gameId)) { throw "POST response did not contain gameId." }
if ([string]::IsNullOrWhiteSpace($game.hostToken)) { throw "POST response did not contain hostToken." }
if ($game.phase -ne "lobby") { throw "New game should be in phase lobby, got '$($game.phase)'." }

$gameId = [uri]::EscapeDataString([string]$game.gameId)
$hostHeaders = @{ "x-host-token" = $game.hostToken }
Write-Host "Created game: $($game.gameId)" -ForegroundColor Green

Write-Host "Testing GET as player and as host..." -ForegroundColor Cyan

$asPlayer = Invoke-Api -Method "GET" -Uri "$api/games/$gameId"
if ($null -ne $asPlayer.hostToken) { throw "GET leaked hostToken." }
if ($null -ne $asPlayer.quiz) { throw "GET without host token leaked the whole quiz." }
if ($null -eq $asPlayer.serverNow) { throw "GET did not return serverNow." }

$asHost = Invoke-Api -Method "GET" -Uri "$api/games/$gameId" -Headers $hostHeaders
if (@($asHost.quiz.questions).Count -ne 2) { throw "Host GET did not return the quiz." }
if ($null -ne $asHost.hostToken) { throw "Host GET leaked hostToken." }

Write-Host "Testing two players joining..." -ForegroundColor Cyan

Invoke-Api -Method "POST" -Uri "$api/games/$gameId/players" -Body @{ playerId = "p1"; name = "Anna" } | Out-Null
$joinResponse = Invoke-Api -Method "POST" -Uri "$api/games/$gameId/players" -Body @{ playerId = "p2"; name = "Bo" }
Invoke-Api -Method "POST" -Uri "$api/games/$gameId/players" -Body @{ playerId = "p2"; name = "Bo" } | Out-Null
$afterJoin = Invoke-Api -Method "GET" -Uri "$api/games/$gameId"
if (@($afterJoin.joined).Count -ne 2) { throw "Expected 2 joined players (rejoin must not duplicate), got $(@($afterJoin.joined).Count)." }
Write-Host "2 players joined" -ForegroundColor Green

Write-Host "Testing PATCH without host token (expect 403) and answer in lobby (expect 409)..." -ForegroundColor Cyan

Invoke-ApiExpectingStatus -Method "PATCH" -Uri "$api/games/$gameId" -Body @{ action = "start" } -ExpectedStatus 403
Invoke-ApiExpectingStatus -Method "POST" -Uri "$api/games/$gameId/answers" -Body @{ playerId = "p1"; questionIndex = 0; choice = 0 } -ExpectedStatus 409

Write-Host "Testing start..." -ForegroundColor Cyan

$started = Invoke-Api -Method "PATCH" -Uri "$api/games/$gameId" -Headers $hostHeaders -Body @{ action = "start" }
if ($started.phase -ne "question" -or [int]$started.currentIndex -ne 0) { throw "start did not open question 0." }
Invoke-ApiExpectingStatus -Method "PATCH" -Uri "$api/games/$gameId" -Headers $hostHeaders -Body @{ action = "start" } -ExpectedStatus 409

$duringQuestion = Invoke-Api -Method "GET" -Uri "$api/games/$gameId"
if ($null -ne $duringQuestion.correct) { throw "Answer key LEAKED to a player during the question." }
if ($null -ne $duringQuestion.question.correct) { throw "Answer key LEAKED inside the question during the question." }
if ($null -ne $duringQuestion.leaderboard) { throw "Leaderboard should not be shown during a question." }
if ($duringQuestion.question.text -ne "Huvudstad i Peru?") { throw "Players did not get the current question text." }
Write-Host "No answer key visible to players during the question" -ForegroundColor Green

Write-Host "Testing answers..." -ForegroundColor Cyan

Invoke-Api -Method "POST" -Uri "$api/games/$gameId/answers" -Body @{ playerId = "p1"; questionIndex = 0; choice = 0 } | Out-Null
Invoke-Api -Method "POST" -Uri "$api/games/$gameId/answers" -Body @{ playerId = "p2"; questionIndex = 0; choice = 1 } | Out-Null
Invoke-ApiExpectingStatus -Method "POST" -Uri "$api/games/$gameId/answers" -Body @{ playerId = "p1"; questionIndex = 0; choice = 1 } -ExpectedStatus 409
Invoke-ApiExpectingStatus -Method "POST" -Uri "$api/games/$gameId/answers" -Body @{ playerId = "stranger"; questionIndex = 0; choice = 0 } -ExpectedStatus 403
Invoke-ApiExpectingStatus -Method "POST" -Uri "$api/games/$gameId/answers" -Body @{ playerId = "p2"; questionIndex = 1; choice = 0 } -ExpectedStatus 409

$answered = Invoke-Api -Method "GET" -Uri "$api/games/$gameId"
if ([int]$answered.answeredCount -ne 2) { throw "Expected answeredCount 2, got $($answered.answeredCount)." }

Write-Host "Testing reveal..." -ForegroundColor Cyan

$revealed = Invoke-Api -Method "PATCH" -Uri "$api/games/$gameId" -Headers $hostHeaders -Body @{ action = "reveal" }
if ([int]$revealed.correct -ne 0) { throw "reveal did not include the correct option." }
$board = @($revealed.leaderboard)
if ($board[0].name -ne "Anna" -or [int]$board[0].score -lt 500 -or [int]$board[1].score -ne 0) {
    throw "Unexpected leaderboard after reveal: $($board | ConvertTo-Json -Compress)"
}
Write-Host "Anna leads with $($board[0].score) p" -ForegroundColor Green

Write-Host "Testing next, end and idempotent end..." -ForegroundColor Cyan

$next = Invoke-Api -Method "PATCH" -Uri "$api/games/$gameId" -Headers $hostHeaders -Body @{ action = "next" }
if ($next.phase -ne "question" -or [int]$next.currentIndex -ne 1) { throw "next did not open question 1." }

$ended = Invoke-Api -Method "PATCH" -Uri "$api/games/$gameId" -Headers $hostHeaders -Body @{ action = "end" }
if ($ended.phase -ne "finished") { throw "end did not finish the game." }
$endedAgain = Invoke-Api -Method "PATCH" -Uri "$api/games/$gameId" -Headers $hostHeaders -Body @{ action = "end" }
if ($endedAgain.phase -ne "finished") { throw "A repeat end must still report finished." }

Invoke-ApiExpectingStatus -Method "POST" -Uri "$api/games/$gameId/players" -Body @{ playerId = "late"; name = "Late" } -ExpectedStatus 409

$final = Invoke-Api -Method "GET" -Uri "$api/games/$gameId"
if (@($final.leaderboard).Count -ne 2) { throw "Final leaderboard should list both players." }

Write-Host ""
Write-Host "All API tests passed." -ForegroundColor Green
