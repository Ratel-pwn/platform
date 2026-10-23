@echo off
setlocal
node "%~dp0start-local.cjs" --open-browser
if errorlevel 1 (
  echo Startup failed. Check the error output above.
  pause
  exit /b 1
)
