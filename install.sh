#!/usr/bin/env bash
# Instala ou atualiza o palco com os pacotes da última release do GitHub.
#   curl -fsSL https://raw.githubusercontent.com/NatanVP/palco/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/NatanVP/palco/main/install.sh | bash -s -- --flatpak
set -euo pipefail

releases=https://github.com/NatanVP/palco/releases/latest/download
app_id=io.github.NatanVP.palco
tmp=''

die() { echo "palco: $*" >&2; exit 1; }
cleanup() { [[ -z $tmp ]] || rm -rf -- "$tmp"; }

usage() {
  cat <<'EOF'
Instala ou atualiza o palco (Linux x86_64).

  --pacman    pacote do Arch e derivados (pede a senha pelo sudo)
  --flatpak   Flatpak do seu usuário
  -h, --help  esta ajuda

Sem opção, usa o pacman se ele existir; senão, o Flatpak.
EOF
}

download() {
  curl -fL --proto '=https' --retry 3 --progress-bar -o "$tmp/$1" "$releases/$1" || die "não consegui baixar $1."
}

main() {
  local method='' file input=/dev/null
  (( $# <= 1 )) || die 'use uma opção por vez (veja --help).'
  case ${1-} in
    --pacman) method=pacman ;;
    --flatpak) method=flatpak ;;
    -h|--help) usage; return 0 ;;
    '')
      if command -v pacman >/dev/null; then method=pacman
      elif command -v flatpak >/dev/null; then method=flatpak
      else die 'preciso do pacman ou do Flatpak. Em outras distribuições, baixe o AppImage ou o .deb na página de releases.'
      fi ;;
    *) die "opção desconhecida: $1 (veja --help)." ;;
  esac

  [[ $(uname -m) == x86_64 ]] || die 'só há pacotes para x86_64.'
  local tool
  for tool in "$method" curl sha256sum awk mktemp; do
    command -v "$tool" >/dev/null || die "não encontrei o comando $tool."
  done

  if [[ $method == pacman ]]; then
    file=palco-x86_64.pkg.tar.zst
    (( EUID == 0 )) || command -v sudo >/dev/null || die 'não encontrei o sudo: rode como root.'
  else
    file=palco-x86_64.flatpak
    (( EUID != 0 )) || die 'rode o Flatpak sem sudo: ele é instalado só para o seu usuário.'
    # Atualizar com o app aberto tira do lugar os arquivos em uso.
    local running
    running=$(flatpak ps --columns=application 2>/dev/null || true)
    [[ $running != *"$app_id"* ]] || die 'o palco do Flatpak está aberto. Feche-o e rode de novo.'
  fi

  tmp=$(mktemp -d)
  trap cleanup EXIT

  echo "Baixando $file..."
  download "$file"
  download SHA256SUMS
  (
    cd "$tmp"
    awk -v file="$file" '$2 == file' SHA256SUMS > expected
    [[ -s expected ]] && sha256sum --check --status expected
  ) || die "o SHA-256 de $file não confere; nada foi instalado."

  # Com `curl | bash`, a entrada padrão é o próprio script: as perguntas precisam vir do terminal.
  if { : </dev/tty; } 2>/dev/null; then input=/dev/tty; fi

  if [[ $method == pacman ]]; then
    local elevate=()
    (( EUID == 0 )) || elevate=(sudo)
    "${elevate[@]}" pacman -U "$tmp/$file" <"$input" || die 'o pacman não instalou o pacote.'
  else
    flatpak install --user --reinstall --bundle "$tmp/$file" <"$input" || die 'o Flatpak não instalou o pacote.'
    echo "Para abrir: menu de aplicativos ou flatpak run $app_id"
  fi

  echo 'Pronto. Se o palco estava aberto, feche e abra de novo. Para atualizar, rode este comando outra vez.'
}

main "$@"
