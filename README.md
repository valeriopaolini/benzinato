# Benzinato

Web app PWA statica, mobile-first, per consultare i prezzi carburante pubblicati dal MIMIT. Non usa un backend: il generatore locale prepara JSON per provincia e carburante; il browser scarica soltanto i dataset scelti dall'utente e li conserva in IndexedDB.

## Avvio locale

```sh
python3 -m http.server 8000
```

Aprire `http://localhost:8000`. Il repository include pochi record **dimostrativi**, chiaramente riconoscibili, per provare l'interfaccia; eseguendo il generatore vengono sostituiti dai dati MIMIT correnti.

## Aggiornamento dati

```sh
python3 tools/update_data.py
```

Gli URL ufficiali sono già configurati. Per usare file locali o mirror:

```sh
python3 tools/update_data.py --stations anagrafica.csv --prices prezzi.csv --output data
```

Le tipologie commerciali presenti in `descCarburante` vengono raggruppate secondo `config/type_map.csv`. Il CSV ha le colonne `tipologia,gruppo`; ogni nuova tipologia MIMIT deve essere aggiunta esplicitamente. Se una tipologia non è mappata, il generatore termina con stato `22` senza pubblicare un dataset parziale. Ogni record conserva il valore MIMIT originale nel campo `product`.

Il parser accetta gli export moderni separati da `|` e quelli storici separati da `;`. Le righe senza coordinate, con provincia ignota o prezzo/data non validi vengono escluse; se la quota valida scende sotto il 70%, l'esecuzione fallisce.

Stati di uscita: `0` aggiornato, `10` invariato, `20` fonte non disponibile, `21` formato inatteso, `22` validazione fallita, `30` errore locale.

`tools/publish_data.sh` esegue il generatore e, soltanto allo stato `0`, crea commit e push. Lo stato `10` è trattato come conclusione normale.

## Test

```sh
python3 -m unittest discover -s tests -v
```

## Pubblicazione

La root del repository è pronta per GitHub Pages. Leaflet è caricato da un CDN e le tile OpenStreetMap richiedono rete; app shell e dataset già scaricati restano invece disponibili offline. Per una distribuzione senza dipendenze CDN, salvare Leaflet nel repository e aggiornare i riferimenti in `index.html` e nella precache.

I dati MIMIT sono distribuiti con licenza IODL 2.0. La cartografia è © OpenStreetMap contributors.
