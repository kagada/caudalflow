@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1

rem 从脚本所在目录构建，安装始终使用本次构建输出，避免误装旧副本。
set "APK=android\app\build\outputs\apk\debug\app-debug.apk"
set "OUTPUT=release\android\CaudalFlow-2.0.3-android-dev-debug.apk"
set "ADB=adb"
set "BUILD_ONLY="
set "DEVICE_ARGS="
if /i "%~1"=="--build-only" (
    set "BUILD_ONLY=1"
) else if not "%~1"=="" (
    set DEVICE_ARGS=-s "%~1"
)

rem 优先使用 Android SDK 内的 ADB，避免 PATH 中的旧版工具。
if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if defined ANDROID_HOME if exist "%ANDROID_HOME%\platform-tools\adb.exe" set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
if defined ANDROID_SDK_ROOT if exist "%ANDROID_SDK_ROOT%\platform-tools\adb.exe" set "ADB=%ANDROID_SDK_ROOT%\platform-tools\adb.exe"

rem 安装模式先确认设备可用，避免编译结束后才发现无法安装；仅构建模式仍可离线使用。
if defined BUILD_ONLY goto build
echo 检查 ADB 设备...
"%ADB%" devices
if errorlevel 1 goto device_failed
"%ADB%" %DEVICE_ARGS% get-state
if errorlevel 1 goto device_failed

:build
echo [1/3] 构建安卓 APK...
call npm.cmd run android:build
if errorlevel 1 goto build_failed
if not exist "%APK%" goto build_failed

echo [2/3] 更新固定文件名的 APK...
if not exist "release\android" mkdir "release\android"
if errorlevel 1 goto failed
copy /y "%APK%" "%OUTPUT%" >nul
if errorlevel 1 goto failed
node.exe -e "const fs=require('node:fs'),crypto=require('node:crypto'),dir='release/android/'; const hashes=fs.readdirSync(dir).filter(name=>name.endsWith('.apk')).sort().map(name=>crypto.createHash('sha256').update(fs.readFileSync(dir+name)).digest('hex')+'  '+name); fs.writeFileSync(dir+'SHA256SUMS.txt',hashes.join('\n')+'\n');"
if errorlevel 1 goto failed
if defined BUILD_ONLY goto success

echo [3/3] 检查设备并安装刚生成的 APK...
"%ADB%" %DEVICE_ARGS% get-state
if errorlevel 1 goto device_failed
"%ADB%" %DEVICE_ARGS% install -r "%APK%"
if errorlevel 1 goto install_failed

:success
echo.
if defined BUILD_ONLY (echo 构建完成，已跳过安装。) else (echo 构建和安装完成。)
echo APK: %~dp0%OUTPUT%
popd
pause
exit /b 0

:build_failed
echo 构建失败，未安装 APK。请查看上方错误信息。
goto failed

:device_failed
echo 未找到唯一且已授权的设备。请连接手机并允许 USB 调试。
echo 多台设备连接时，运行: build-install-android.bat 设备序列号
"%ADB%" devices
goto failed

:install_failed
echo 安装失败，APK 已保留。请查看上方错误信息。

:failed
popd
pause
exit /b 1
