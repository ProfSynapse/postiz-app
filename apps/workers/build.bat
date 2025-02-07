@echo off
echo Copying shared libraries...
xcopy /E /I /Y ..\shared shared

echo Building Docker image...
docker build -t postiz-workers .

echo Cleaning up...
rmdir /S /Q shared

echo Build complete!
