@echo off
set "PATH=C:\Users\Admin\Projects\tools\node24;%PATH%"
cd /d "C:\Users\Admin\Projects\osrs-gearfinder"
start "GearFinder server" /min cmd /c "npm run dev"
timeout /t 3 /nobreak >nul
start "" http://localhost:5173
