#!/bin/zsh
set -euo pipefail

project_root="${0:A:h:h}"
build_root="$project_root/.build/personal-os-macos"
app="$build_root/Personal OS.app"
contents="$app/Contents"
resources="$contents/Resources"
iconset="$build_root/PersonalOS.iconset"
sdk="/Library/Developer/CommandLineTools/SDKs/MacOSX13.3.sdk"

rm -rf "$build_root"
mkdir -p "$contents/MacOS" "$resources" "$iconset"

swiftc "$project_root/desktop/PersonalOSApp.swift" \
  -o "$contents/MacOS/Personal OS" \
  -parse-as-library \
  -sdk "$sdk" -module-cache-path "$build_root/ModuleCache" \
  -framework SwiftUI -framework WebKit -framework AppKit
cp "$project_root/desktop/Info.plist" "$contents/Info.plist"
print -r -- "$project_root" > "$resources/project-root.txt"

node "$project_root/scripts/generate-app-icon.mjs" "$build_root/icon-1024.png"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$build_root/icon-1024.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$build_root/icon-1024.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
node "$project_root/scripts/generate-icns.mjs" "$resources/PersonalOS.icns" \
  "$iconset/icon_16x16.png" "$iconset/icon_16x16@2x.png" "$iconset/icon_32x32@2x.png" \
  "$iconset/icon_128x128.png" "$iconset/icon_128x128@2x.png" \
  "$iconset/icon_256x256@2x.png" "$iconset/icon_512x512@2x.png"
codesign --force --deep --sign - "$app"

print -r -- "$app"
