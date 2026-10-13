#!/bin/zsh -f

# Finder aliases and symbolic links should still use the repository directory.
project_root="${0:A:h}"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/Library/pnpm/bin:$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin:/opt/gda/bin:$PATH"

# Finder does not load .zshrc, where NVM normally adds Node to PATH.
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    source "$NVM_DIR/nvm.sh" --no-use
    nvm use --silent default >/dev/null
  fi
fi

launcher_python="$project_root/.venv/bin/python"
if [[ ! -x "$launcher_python" ]]; then
  launcher_python="$(command -v python3)"
fi
if [[ -z "$launcher_python" ]]; then
  print 'Python is missing. Please ask the person who installed Bildutforskaren to complete the setup.'
  [[ -t 0 ]] && read '?Press Enter to close.'
  exit 1
fi

"$launcher_python" "$project_root/scripts/launch_desktop.py"
result=$?
if (( result != 0 )) && [[ -t 0 ]]; then
  read '?Press Enter to close.'
fi
exit "$result"
