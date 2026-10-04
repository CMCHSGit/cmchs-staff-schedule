@echo off
rem Publishes SimproSync (schedule.chsnz.co.nz/simprosync/) - commits ONLY the SimproSync files and pushes.
cd /d "%~dp0"
git add simprosync vite.config.js firestore.rules
git commit -m "Add SimproSync admin page (Simpro asset sync + job completion)"
if errorlevel 1 (echo. & echo Nothing committed - see message above. & pause & exit /b 1)
git push
echo.
echo Pushed. GitHub Actions will deploy in a couple of minutes:
echo https://github.com/CMCHSGit/cmchs-staff-schedule/actions
pause
