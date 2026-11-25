@echo off
chcp 65001 >nul
cd /d "%~dp0"

if "%~1"=="--bg" goto :run_background

where node >nul 2>nul
if errorlevel 1 (
  echo [안내] Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  echo.
  start https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\.bin\tsx.cmd" (
  echo ==========================================
  echo   종목노트 최초 설치 중...
  echo ==========================================
  echo.
  echo [최초 1회] 필요한 구성 요소를 설치하고 있습니다. 1~2분 정도 걸릴 수 있습니다...
  call npm install --legacy-peer-deps --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [오류] 설치에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 실행해 주세요.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c call start_jongmok_note.bat --bg' -WindowStyle Hidden"
exit /b 0

:run_background
set "APP_PROFILE=%LOCALAPPDATA%\JongmokNoteApp"
set "ALREADY_RUNNING=0"

node -e "require('http').get('http://127.0.0.1:3000',r=>{r.resume();process.exit(0);}).on('error',()=>process.exit(1));" >nul 2>nul
if not errorlevel 1 set "ALREADY_RUNNING=1"

if "%ALREADY_RUNNING%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c node_modules\.bin\tsx.cmd server.ts' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $env:TEMP 'jongmok_note_out.log') -RedirectStandardError (Join-Path $env:TEMP 'jongmok_note_err.log')"
  node -e "const h=require('http');let n=0;const p=()=>{h.get('http://127.0.0.1:3000',r=>{r.resume();process.exit(0);}).on('error',()=>{if(++n<60)setTimeout(p,500);else process.exit(1);});};setTimeout(p,500);"
  if errorlevel 1 exit /b 1
)

set "BROWSER_EXE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER_EXE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER_EXE if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined BROWSER_EXE (
  if "%ALREADY_RUNNING%"=="0" (
    start /wait "" "%BROWSER_EXE%" --app=http://localhost:3000 --user-data-dir="%APP_PROFILE%" --disable-background-mode --no-first-run --no-default-browser-check
    node -e "const h=require('http');const body=JSON.stringify({confirm:'shutdown'});const req=h.request('http://127.0.0.1:3000/api/local-shutdown',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},r=>{r.resume();process.exit(0);});req.on('error',()=>process.exit(0));req.write(body);req.end();"
  ) else (
    start "" "%BROWSER_EXE%" --app=http://localhost:3000 --user-data-dir="%APP_PROFILE%" --disable-background-mode --no-first-run --no-default-browser-check
  )
) else (
  start http://localhost:3000
)
exit /b 0
