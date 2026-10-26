$env:ELECTRON_RUN_AS_NODE = $null
Set-Location $PSScriptRoot
& ".\node_modules\electron\dist\electron.exe" "."
