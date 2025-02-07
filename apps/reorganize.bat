@echo off
echo Creating backup...
mkdir ..\postiz-backup
xcopy /E /I /Y ..\* ..\postiz-backup\

echo Setting up new structure...
cd ..

echo Moving libraries...
mkdir apps\shared\libraries
mkdir apps\shared\libraries\helpers
mkdir apps\shared\libraries\nestjs-libraries
mkdir apps\shared\libraries\plugins
mkdir apps\shared\libraries\react-shared-libraries

xcopy /E /I /Y libraries\helpers\* apps\shared\libraries\helpers\
xcopy /E /I /Y libraries\nestjs-libraries\* apps\shared\libraries\nestjs-libraries\
xcopy /E /I /Y libraries\plugins\* apps\shared\libraries\plugins\
xcopy /E /I /Y libraries\react-shared-libraries\* apps\shared\libraries\react-shared-libraries\

echo Updating tsconfig paths...
powershell -Command "(Get-Content apps\*/tsconfig.json) -replace '@gitroom/helpers', '@postiz/shared/helpers' | Set-Content apps\*/tsconfig.json"
powershell -Command "(Get-Content apps\*/tsconfig.json) -replace '@gitroom/nestjs-libraries', '@postiz/shared/nestjs-libraries' | Set-Content apps\*/tsconfig.json"
powershell -Command "(Get-Content apps\*/tsconfig.json) -replace '@gitroom/plugins', '@postiz/shared/plugins' | Set-Content apps\*/tsconfig.json"
powershell -Command "(Get-Content apps\*/tsconfig.json) -replace '@gitroom/react', '@postiz/shared/react' | Set-Content apps\*/tsconfig.json"

echo Removing old libraries directory...
rmdir /S /Q libraries

echo Installing dependencies...
cd apps
call npm install

echo Building services...
call npm run build:all

echo.
echo Reorganization complete!
echo Please update your Railway service configurations according to apps/README.md
echo.
echo For each service in Railway, set:
echo.
echo 1. Frontend:
echo    - Root Directory: /apps/frontend
echo    - Build Command: npm install ^&^& npm run build
echo    - Start Command: npm run start:prod
echo    - Port: 6000
echo.
echo 2. Backend:
echo    - Root Directory: /apps/backend
echo    - Build Command: npm install ^&^& npm run build
echo    - Start Command: npm run start:prod
echo    - Port: 8080
echo.
echo 3. Workers:
echo    - Root Directory: /apps/workers
echo    - Build Command: npm install ^&^& npm run build
echo    - Start Command: npm run start:prod
echo    - Port: 4000
echo.
echo 4. Cron:
echo    - Root Directory: /apps/cron
echo    - Build Command: npm install ^&^& npm run build
echo    - Start Command: npm run start:prod
echo    - Port: 5000
echo.
pause
