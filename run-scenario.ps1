param(
  [Parameter(Mandatory = $true)]
  [string]$Scenario
)

node .\testing\run-scenario.mjs --scenario $Scenario
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
