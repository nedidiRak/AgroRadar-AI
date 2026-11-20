#!/usr/bin/env bash
# Compile the real local expert evaluator as a native Apple .app.
# Run on a macOS 15 GitHub Actions runner (arm64 or x86_64).
set -euo pipefail
cd "$(dirname "$0")/.."

test -f frontend/dist/index.html || { echo "Build React in frontend first"; exit 1; }
test -f backend/app/agrorisk_research.json || { echo "Missing agronomy research dataset"; exit 1; }
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) LABEL="AppleSilicon" ;;
  x86_64) LABEL="Intel" ;;
  *) echo "Unsupported macOS architecture: $ARCH"; exit 1 ;;
esac

python -m PyInstaller --clean --noconfirm --onedir --windowed \
  --name "AgroRadar-Expert" \
  --osx-bundle-identifier "ai.agroradar.expert" \
  --add-data "frontend/dist:frontend/dist" \
  --add-data "backend/app/agrorisk_research.json:app" \
  --add-data "packaging/settings.env.example:." \
  --collect-submodules uvicorn \
  --collect-submodules app \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import uvicorn.lifespan.on \
  backend/portable_expert.py

APP="dist/AgroRadar-Expert.app"
test -x "$APP/Contents/MacOS/AgroRadar-Expert" || {
  echo "Missing executable inside macOS app"; exit 1;
}
codesign --verify --deep --strict --verbose=2 "$APP"

STAGING="dist/AgroRadar-Expert-macOS-$LABEL"
ZIP="dist/AgroRadar-Expert-macOS-$LABEL.zip"
rm -rf "$STAGING" "$ZIP"
mkdir -p "$STAGING"
ditto "$APP" "$STAGING/AgroRadar-Expert.app"
cp packaging/EXPERT_MAC_README.txt "$STAGING/README_FIRST.txt"
cp packaging/settings.env.example "$STAGING/settings.env.example"
# ditto preserves executable bits and .app symlinks. Uploading the .app itself
# to GitHub Actions artifacts would flatten its permissions and break launch.
ditto -c -k --sequesterRsrc --keepParent "$STAGING" "$ZIP"
test -s "$ZIP"
echo "READY $ZIP"
du -h "$ZIP"
