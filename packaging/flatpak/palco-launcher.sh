#!/bin/sh
# Lançador do Flatpak do palco. O app não roda no sandbox: este script acha onde o Flatpak instalou
# os arquivos no sistema e abre o palco lá, para os terminais enxergarem claude, codex, git e o resto.
set -eu

app_path=$(sed -n 's/^app-path=//p' /.flatpak-info 2>/dev/null || true)
if [ -z "$app_path" ]; then
  echo 'palco: não foi possível achar o caminho do app no sistema (/.flatpak-info).' >&2
  exit 1
fi

# Só passam as variáveis próprias deste lançamento (foco e aviso de abertura da janela). Tela, D-Bus e
# pastas XDG vêm da sessão do usuário no sistema; os valores do sandbox apontariam para outros lugares.
set -- "$app_path/palco/palco" "$@"
[ -z "${DESKTOP_STARTUP_ID-}" ] || set -- "--env=DESKTOP_STARTUP_ID=$DESKTOP_STARTUP_ID" "$@"
[ -z "${XDG_ACTIVATION_TOKEN-}" ] || set -- "--env=XDG_ACTIVATION_TOKEN=$XDG_ACTIVATION_TOKEN" "$@"

# --watch-bus: se o Flatpak for encerrado (flatpak kill), o app no sistema também recebe o sinal.
exec flatpak-spawn --host --watch-bus "--directory=$HOME" "$@"
