#!/usr/bin/env bash
# Empacota dist/linux-unpacked como Flatpak, sem flatpak-builder e sem baixar nada.
# Rode por `npm run dist:flatpak`. Saída: repositório em dist/flatpak/ e dist/palco-<versão>.flatpak.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
id=io.github.NatanVP.palco
runtime=26.08
version=$(cd "$root" && node -p "require('./package.json').version")
unpacked="$root/dist/linux-unpacked"
# O build precisa levar o id do Flatpak, senão a janela fica sem ícone no Wayland.
grep -aqF "$id.desktop" "$unpacked/resources/app.asar" 2>/dev/null || { echo "Falta o build do Flatpak em $unpacked: rode npm run dist:flatpak." >&2; exit 1; }

# O repositório é mantido entre execuções: cada export vira um commit novo, que `flatpak update` busca.
repo="$root/dist/flatpak"
work="$root/dist/flatpak-build"
rm -rf "$work"
flatpak build-init "$work" "$id" org.freedesktop.Platform org.freedesktop.Platform "$runtime"

cp -a "$unpacked" "$work/files/palco"
install -Dm755 "$root/packaging/flatpak/palco-launcher.sh" "$work/files/bin/palco-launcher"
install -Dm644 "$root/packaging/flatpak/$id.desktop" "$work/files/share/applications/$id.desktop"
install -d "$work/files/share/metainfo"
sed -e "s/@VERSION@/$version/" -e "s/@DATE@/$(date -u +%F)/" "$root/packaging/flatpak/$id.metainfo.xml" > "$work/files/share/metainfo/$id.metainfo.xml"
for size in 16 24 32 48 64 128 256 512; do
  install -Dm644 "$root/resources/icons/palco-$size.png" "$work/files/share/icons/hicolor/${size}x$size/apps/$id.png"
done

# Única permissão: pedir ao Flatpak para abrir o app no sistema.
flatpak build-finish "$work" --command=palco-launcher --talk-name=org.freedesktop.Flatpak
flatpak build-export --subject="palco $version" "$repo" "$work"
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo "$repo" "$root/dist/palco-$version.flatpak" "$id"
echo "Pronto: $repo e $root/dist/palco-$version.flatpak"
