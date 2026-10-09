#!/bin/zsh
set -eu
cd "${0:A:h:h}"
project_dir="$PWD"
mkdir -p .build/cache .build/module-cache .build/clang-cache
CLANG_MODULE_CACHE_PATH="$project_dir/.build/clang-cache" SWIFTPM_MODULECACHE_OVERRIDE="$project_dir/.build/module-cache" swift build --disable-sandbox --cache-path "$project_dir/.build/cache" -Xswiftc -module-cache-path -Xswiftc "$project_dir/.build/module-cache"
app_dir="$project_dir/dist/Agent Deck Dev.app"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources/code"
cp assets/AgentDeck.icns "$app_dir/Contents/Resources/AgentDeck.icns"
cp .build/debug/AgentDeck "$app_dir/Contents/MacOS/AgentDeck"
for component in core sdk plugins web integrations; do
  mkdir -p "$app_dir/Contents/Resources/code/$component"
  cp -R "$component/" "$app_dir/Contents/Resources/code/$component/"
done
cp package.json package-lock.json "$app_dir/Contents/Resources/code/"
rm -rf "$app_dir/Contents/Resources/code/node_modules"
cp -R node_modules "$app_dir/Contents/Resources/code/node_modules"
# Development-only wrapper, tied to this machine's Node executable and project data.
python3 - "$app_dir/Contents/Info.plist" "$(command -v node)" "$project_dir/.data" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'wb') as file:
    plistlib.dump({'CFBundleName':'Agent Deck Dev','CFBundleDisplayName':'Agent Deck Dev','CFBundleIdentifier':'dev.agentdeck.local','CFBundleExecutable':'AgentDeck','CFBundlePackageType':'APPL','CFBundleIconFile':'AgentDeck.icns','CFBundleShortVersionString':'0.1.0','LSMinimumSystemVersion':'14.0','AgentDeckNodeExecutable':sys.argv[2],'AgentDeckDataDirectory':sys.argv[3]}, file)
PY
codesign --force --sign - "$app_dir"
printf '%s\n' "$app_dir"
