#!/bin/sh
set -u
cd "$(dirname "$0")/.." || exit 30
python3 tools/update_data.py "$@"
status=$?
case "$status" in
  0)
    git add data
    if git diff --cached --quiet; then
      echo "Nessuna modifica da pubblicare."
      exit 10
    fi
    git commit -m "Update MIMIT fuel data" && git push
    ;;
  10) echo "Dati già aggiornati; nessun commit."; exit 0 ;;
  20|21|22|30) echo "Generazione fallita (stato $status)." >&2; exit "$status" ;;
  *) echo "Stato inatteso dal generatore: $status" >&2; exit "$status" ;;
esac
