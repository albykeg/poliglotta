#!/bin/bash
# Poliglotta - aggiornamento da GitHub (Mac). Doppio clic per aggiornare.
# Tutto dentro main(): bash legge l'intera funzione prima di eseguirla,
# quindi questo file può essere sostituito mentre gira.
main() {
  cd "$(dirname "$0")" || exit 1
  local DIR; DIR="$(pwd)"
  pausa() { [ -n "$POLIGLOTTA_SILENZIOSO" ] || { echo; read -r -p "Premi Invio per chiudere " _; }; }
  fail() { echo "Aggiornamento non riuscito: $1"; pausa; exit 1; }
  val() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$2" | head -1; }
  newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" = "$1" ]; }

  local REPO API LOCAL TMP REMOTE URL SRC
  REPO=$(val repo update.json)
  [ -n "$REPO" ] || fail "update.json non indica dove sono pubblicate le versioni."
  API=${POLIGLOTTA_API:-$(val api update.json)}; API=${API:-https://api.github.com}; API=${API%/}
  LOCAL=$(val version manifest.json)
  echo "Versione installata: $LOCAL"

  TMP=$(mktemp -d) || fail "impossibile creare una cartella temporanea."
  trap 'rm -rf "$TMP"' EXIT
  if curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: Poliglotta' \
    "$API/repos/$REPO/releases/latest" -o "$TMP/rel.json" 2>/dev/null; then
    REMOTE=$(val tag_name "$TMP/rel.json"); REMOTE=${REMOTE#v}; REMOTE=${REMOTE#V}
    URL=$(grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*\.zip"' "$TMP/rel.json" | head -1 | sed 's/.*"\(http[^"]*\)"$/\1/')
  else
    # GitHub limita le richieste anonime (60 all'ora): leggo la versione dal file pubblico del repository.
    curl -fsSL -H 'User-Agent: Poliglotta' "https://raw.githubusercontent.com/$REPO/main/poliglotta/manifest.json" \
      -o "$TMP/man.json" || fail "GitHub non raggiungibile."
    REMOTE=$(val version "$TMP/man.json")
  fi
  URL=${URL:-https://github.com/$REPO/releases/latest/download/Poliglotta.zip}
  if ! newer "$REMOTE" "$LOCAL"; then echo "Poliglotta è già aggiornata."; pausa; exit 0; fi

  echo "Scarico la versione $REMOTE..."
  curl -fsSL -H 'User-Agent: Poliglotta' "$URL" -o "$TMP/p.zip" || fail "download non riuscito."
  mkdir "$TMP/x" && unzip -q "$TMP/p.zip" -d "$TMP/x" || fail "lo zip scaricato non è valido."
  SRC="$TMP/x/poliglotta"; [ -f "$SRC/manifest.json" ] || SRC="$TMP/x"
  [ -f "$SRC/manifest.json" ] || fail "lo zip scaricato non contiene Poliglotta."

  # Copio tutti i file, il manifest per ultimo: così Chrome non vede mai una versione a metà.
  (cd "$SRC" && find . -type f ! -path './manifest.json') | while IFS= read -r f; do
    mkdir -p "$DIR/$(dirname "$f")" && cp "$SRC/$f" "$DIR/$f"
  done
  cp "$SRC/manifest.json" "$DIR/manifest.json"
  chmod +x "$DIR/Aggiorna Poliglotta.command" 2>/dev/null
  xattr -dr com.apple.quarantine "$DIR" 2>/dev/null

  echo "Fatto! Poliglotta è aggiornata alla versione $REMOTE."
  echo "Per attivarla chiudi e riapri Chrome (oppure clicca Ricarica su Poliglotta in chrome://extensions),"
  echo "poi premi F5 su Facebook."
  pausa
  exit 0
}
main "$@"; exit
