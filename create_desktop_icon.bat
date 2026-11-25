@echo off
chcp 65001 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desk = [Environment]::GetFolderPath('Desktop'); $name = ([char]0xC885+[char]0xBAA9+[char]0xB178+[char]0xD2B8+'.lnk'); $dir = (Get-Location).Path; $lnk = $ws.CreateShortcut((Join-Path $desk $name)); $lnk.TargetPath = (Join-Path $dir 'start_jongmok_note.bat'); $lnk.WorkingDirectory = $dir; $lnk.IconLocation = (Join-Path $dir 'jongmok_note.ico'); $lnk.WindowStyle = 7; $lnk.Save()"
if errorlevel 1 (
  echo [오류] 바탕화면 바로가기 생성에 실패했습니다.
  pause
  exit /b 1
)

echo.
echo 바탕화면에 종목노트 전용 아이콘을 만들었습니다!
timeout /t 2 >nul
