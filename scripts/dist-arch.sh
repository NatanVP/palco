#!/usr/bin/env bash
# Gera o pacote do Arch a partir do .deb de `npm run dist:linux`. O resultado fica em dist/.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
version=$(cd "$root" && node -p "require('./package.json').version")
deb="$root/dist/palco_${version}_amd64.deb"
[[ -f $deb ]] || { echo "Falta $deb: rode npm run dist:linux antes." >&2; exit 1; }
[[ -f $root/LICENSE ]] || { echo "Falta $root/LICENSE." >&2; exit 1; }

deb_sha256=$(sha256sum -- "$deb" | awk '{ print $1 }')
license_sha256=$(sha256sum -- "$root/LICENSE" | awk '{ print $1 }')
[[ $deb_sha256 =~ ^[0-9a-f]{64}$ && $license_sha256 =~ ^[0-9a-f]{64}$ ]] || { echo 'Não foi possível calcular os SHA-256 das entradas.' >&2; exit 1; }

work="$root/dist/arch"
rm -rf "$work"
mkdir -p "$work"
cp "$root/packaging/arch/PKGBUILD" "$root/LICENSE" "$deb" "$work/"
cd "$work"
PALCO_VERSION="$version" PALCO_DEB_SHA256="$deb_sha256" PALCO_LICENSE_SHA256="$license_sha256" \
  PKGDEST="$root/dist" BUILDDIR="$work/build" SRCDEST="$work" makepkg --force "$@"
