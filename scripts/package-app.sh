#!/bin/zsh
set -eu
cd "${0:A:h:h}"
project_dir="$PWD"
node_binary="${AGENT_DECK_NODE:-$(command -v node)}"
architecture="$($node_binary -p 'process.arch')"
case "$architecture" in arm64|x64) ;; *) print -u2 'Unsupported macOS architecture'; exit 1 ;; esac
# Bundled Node must not depend on a build machine's Homebrew installation.
if otool -L "$node_binary" | tail -n +2 | awk '{print $1}' | rg -v '^(/usr/lib/|/System/Library/)' >/dev/null; then
  print -u2 'Use a standalone Node binary from nodejs.org (AGENT_DECK_NODE), not a Homebrew-linked binary.'
  exit 1
fi
mkdir -p .build/cache .build/module-cache .build/clang-cache
CLANG_MODULE_CACHE_PATH="$project_dir/.build/clang-cache" SWIFTPM_MODULECACHE_OVERRIDE="$project_dir/.build/module-cache" swift build -c release --disable-sandbox --cache-path "$project_dir/.build/cache" -Xswiftc -module-cache-path -Xswiftc "$project_dir/.build/module-cache"
app_dir="$project_dir/dist/Agent Deck.app"
rm -rf "$app_dir"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources/code" "$app_dir/Contents/Resources/runtime"
cp .build/release/AgentDeck "$app_dir/Contents/MacOS/AgentDeck"
cp assets/AgentDeck.icns "$app_dir/Contents/Resources/AgentDeck.icns"
cp "$node_binary" "$app_dir/Contents/Resources/runtime/node"
# Include the runtime's license alongside the bundled executable.
node_root="${node_binary:A:h:h}"
if [[ ! -f "$node_root/LICENSE" ]]; then
  print -u2 'Node LICENSE is missing from the standalone runtime installation.'
  exit 1
fi
cp "$node_root/LICENSE" "$app_dir/Contents/Resources/runtime/LICENSE"
for component in core sdk plugins web integrations; do
  cp -R "$component" "$app_dir/Contents/Resources/code/$component"
done
cp package.json package-lock.json LICENSE "$app_dir/Contents/Resources/code/"
npm ci --omit=dev --ignore-scripts --prefix "$app_dir/Contents/Resources/code"
python3 - "$app_dir/Contents/Info.plist" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'wb') as file:
    plistlib.dump({'CFBundleName':'Agent Deck','CFBundleDisplayName':'Agent Deck','CFBundleIdentifier':'dev.agentdeck.app','CFBundleExecutable':'AgentDeck','CFBundlePackageType':'APPL','CFBundleIconFile':'AgentDeck.icns','CFBundleShortVersionString':'0.1.0','CFBundleVersion':'1','LSMinimumSystemVersion':'14.0','NSHighResolutionCapable':True}, file)
PY
codesign --force --sign - "$app_dir/Contents/Resources/runtime/node"
codesign --force --sign - "$app_dir"
codesign --verify --deep --strict "$app_dir"
"$app_dir/Contents/Resources/runtime/node" --version
# Preserve executable permissions, symlinks, and the .app bundle in one archive.
archive="$project_dir/dist/Agent-Deck-macos-$architecture.zip"
rm -f "$archive"
ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$archive"
printf '%s\n' "$archive"
