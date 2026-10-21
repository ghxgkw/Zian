@echo off
rem Launcher: clears ELECTRON_RUN_AS_NODE so the app starts as Electron, not as Node.
setlocal
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="
pushd "%~dp0"
for %%f in ("%~dp0*.exe") do (
  start "" "%%~ff" %*
  goto :done
)
:done
popd
endlocal