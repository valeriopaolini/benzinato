# Benzinato — specifiche di prodotto e implementazione

## 1. Obiettivo

`Benzinato` è una web app statica, mobile-first e installabile sulla schermata Home, che usa i dati pubblici MIMIT per:

- mostrare la classifica dei distributori meno costosi entro un raggio scelto dall'utente;
- mostrare su una mappa i distributori delle province configurate;
- aprire il distributore scelto nell'applicazione di navigazione preferita.

Il progetto deve privilegiare la soluzione più semplice possibile. Non è previsto un backend applicativo.

## 2. Piattaforme e distribuzione

- Repository GitHub.
- Pubblicazione statica con GitHub Pages.
- PWA installabile su iPhone/iPad con “Aggiungi alla schermata Home” e su Android con la funzione equivalente.
- Interfaccia mobile-first, utilizzabile anche in un normale browser desktop.
- HTML, CSS e JavaScript senza framework, salvo necessità concreta.
- Leaflet per la mappa e OpenStreetMap come cartografia.
- Web App Manifest, icone PWA e service worker.
- Nessuna chiave privata deve essere inclusa nel client.

## 3. Componenti del progetto

Il repository contiene due parti distinte.

### 3.1 Web app pubblica

La web app legge file JSON statici già pronti per l'uso, conserva impostazioni e dataset sul dispositivo e non interpreta direttamente i file originali MIMIT.

### 3.2 Generatore locale

Un programma Python eseguito localmente:

1. controlla e scarica anagrafica e prezzi dal MIMIT;
2. riconosce l'eventuale assenza di nuovi dati;
3. valida e unisce i record;
4. genera un file JSON completo per provincia;
5. genera il manifest dei dati;
6. evita di modificare i file il cui contenuto non è cambiato;
7. restituisce uno stato di uscita documentato.

Uno script Bash/Zsh invoca il programma Python e usa lo stato di uscita per decidere se eseguire commit e push su GitHub. Il programma Python non deve eseguire autonomamente commit o push.

Convenzione richiesta per gli stati:

- `0`: dati aggiornati e file generati con successo; lo script shell può pubblicare;
- `10`: nessun aggiornamento; lo script shell termina senza commit;
- `20`: sorgente MIMIT non disponibile;
- `21`: formato della sorgente inatteso;
- `22`: validazione dei dati fallita;
- `30`: errore locale di configurazione o scrittura.

Lo script shell deve trattare esplicitamente `10` come risultato normale e ogni altro valore non previsto come errore.

## 4. Sorgente e modello dei dati

La sorgente è costituita dai dataset ufficiali MIMIT relativi ai prezzi praticati e all'anagrafica degli impianti.

Devono essere supportate tutte le tipologie di carburante presenti nella sorgente. L'elenco dei carburanti non deve essere inutilmente fissato nel codice dell'interfaccia: deve derivare dal manifest generato.

I dati pubblicati dalla pipeline sono:

- suddivisi per provincia;
- strutturati per impianto, con anagrafica unica e tutte le offerte associate;
- JSON UTF-8 non pretty-printed;
- immediatamente visualizzabili dal client;
- nominati con identificatori stabili e sicuri per URL, mantenendo nel manifest l'etichetta originale da mostrare.

Struttura indicativa:

```text
data/
  manifest.json
  BO.json
  RM.json
```

Ogni record deve contenere almeno:

```json
{"id":12345,"name":"Impianto esempio","brand":"Marchio","address":"Via Esempio 10","municipality":"Roma","province":"RM","latitude":41.902,"longitude":12.496,"offers":[{"group":"benzina","product":"Benzina","primary":true,"isSelf":true,"price":1.729,"reportedAt":"2026-09-02T07:42:00+02:00"}]}
```

Ogni impianto contiene tutte le proprie offerte. `group` è la categoria normalizzata usata da filtri e classifica, mentre `product` conserva la denominazione commerciale MIMIT. La classifica preferisce le offerte marcate `primary`; in loro assenza usa la variante meno costosa del gruppo. Self-service e servito restano offerte distinte. Record privi di coordinate valide non vengono pubblicati.

## 5. Manifest dei dati

`data/manifest.json` deve contenere almeno:

- versione dello schema;
- data e ora di generazione;
- elenco delle province, con sigla e nome completo;
- etichetta visuale e identificatore stabile di ogni carburante;
- percorso, hash del contenuto, dimensione, numero di impianti e offerte di ogni file provinciale.

Il manifest è la sola risorsa necessaria per determinare disponibilità e aggiornamenti. L'app non deve interrogare tutti i file per sapere se sono cambiati.

## 6. Cache e aggiornamento dei dati

Le impostazioni sono conservate localmente. I dataset provinciali sono conservati in IndexedDB. Il service worker gestisce l'app shell e le risorse statiche, non deve duplicare senza necessità la cache dei dataset.

L'aggiornamento dei dataset avviene solo dopo un'azione o una conferma dell'utente. L'app può controllare automaticamente il piccolo manifest, ma non deve scaricare automaticamente nuovi dataset provinciali.

Regole:

- nessuna provincia è selezionata al primo avvio;
- senza province configurate non vengono scaricati dataset;
- il controllo riguarda soltanto le province configurate;
- se mancano dati locali necessari, l'app invita a scaricarli;
- se è trascorso almeno un giorno dall'ultimo controllo, l'app suggerisce di verificare gli aggiornamenti;
- il manifest viene richiesto con rivalidazione della cache HTTP;
- hash e versione nel manifest stabiliscono quali file sono effettivamente cambiati;
- l'utente conferma il download;
- vengono scaricati soltanto i file nuovi o modificati;
- in assenza di rete restano disponibili i dati locali, con data dell'ultimo aggiornamento chiaramente visibile.

Se l'utente aggiunge una provincia, l'app propone il download dei file necessari. Se la rimuove, i relativi file possono restare in cache finché l'utente non usa la gestione dello spazio o “Svuota dati”; non devono però comparire nei risultati.

## 7. Avvio e splash screen

- Splash screen con logo e nome `Benzinato`.
- Il logo definitivo sarà fornito successivamente; durante lo sviluppo usare un segnaposto facilmente sostituibile.
- Lo splash completo viene mostrato al massimo una volta al giorno per dispositivo.
- Non deve introdurre un ritardo artificiale.
- Se non esistono province configurate, dopo lo splash appare un invito evidente ad aprire Impostazioni.
- Se esistono province ma mancano i relativi dati locali, appare un invito a scaricarli.
- Se è opportuno controllare gli aggiornamenti, l'app lo suggerisce senza bloccare l'accesso ai dati già presenti.

## 8. Navigazione principale

Barra inferiore persistente con tre destinazioni:

1. **Classifica**
2. **Mappa**
3. **Impostazioni**

La barra deve rispettare la safe area dei dispositivi iOS installati come PWA.

## 9. Impostazioni

La pagina contiene:

### Posizione

- opzione “Usa GPS”;
- latitudine e longitudine manuali;
- con GPS attivo, i campi manuali sono disabilitati;
- non è previsto scegliere la posizione toccando la mappa;
- errore chiaro se coordinate, permesso o geolocalizzazione non sono validi.

### Province

- elenco completo mediante checkbox;
- nessuna selezione iniziale;
- ricerca testuale nell'elenco;
- “Seleziona tutte” e “Deseleziona tutte”;
- le province selezionate definiscono rigorosamente i soli dataset utilizzabili;
- spostarsi fuori dalle province configurate non provoca download automatici.

### Ricerca

- carburante, popolato dai valori disponibili nel manifest;
- modalità: self-service o servito;
- raggio in chilometri: input intero libero, obbligatorio e maggiore di zero;
- ordinamento predefinito: prezzo o distanza, con prezzo come default.

### Età dei prezzi

Due soglie intere in ore determinano tre stati:

- verde: età minore o uguale alla prima soglia;
- giallo: età maggiore della prima e minore o uguale alla seconda;
- rosso: età maggiore della seconda.

Vincoli: prima soglia maggiore di zero; seconda soglia maggiore della prima. Valori iniziali suggeriti: `24` e `72` ore.

### Navigazione esterna

Applicazione preferita:

- Apple Maps;
- Google Maps;
- Waze.

Su piattaforme incompatibili l'app deve usare un URL web funzionante o mostrare una scelta alternativa comprensibile.

### Dati locali

- data dell'ultimo controllo remoto;
- data di generazione dei dati locali;
- spazio occupato;
- “Controlla aggiornamenti”;
- “Scarica/Aggiorna dati” quando necessario;
- “Svuota dati scaricati”;
- “Ripristina impostazioni”.

### Informazioni

- disclaimer su provenienza e possibile non corrispondenza dei prezzi;
- attribuzione MIMIT;
- attribuzione OpenStreetMap;
- versione dell'app.

## 10. Classifica

La Classifica non mostra la cartografia.

Requisiti:

- usa GPS oppure le coordinate manuali configurate;
- considera soltanto record delle province selezionate con dati scaricati;
- filtra per carburante, modalità e raggio;
- ordinamento predefinito per prezzo crescente;
- a parità di prezzo, distanza crescente;
- l'utente può passare all'ordinamento per distanza;
- intestazione sintetica con filtri attivi, per esempio `Gasolio · Self-service · 10 km`;
- i filtri di ricerca possono essere modificati rapidamente senza cambiare la configurazione delle province.

Ogni riga mostra almeno:

- prezzo in evidenza;
- colore verde, giallo o rosso basato sull'età;
- età leggibile, per esempio `aggiornato 7 h fa`;
- nome impianto e marchio, se presente;
- distanza;
- indirizzo e comune;
- modalità;
- icona di apertura esterna chiaramente distinta.

Interazioni obbligatorie:

- tocco sulla riga, esclusa l'icona esterna: apre la sezione **Mappa** interna, centrata e sufficientemente ingrandita sul distributore selezionato;
- tocco sull'icona esterna: apre direttamente l'app di navigazione configurata con quel distributore come destinazione.

La propagazione dell'evento dell'icona esterna deve essere bloccata, per evitare che vengano eseguite entrambe le azioni.

## 11. Mappa

- Mostra tutti gli impianti presenti nei dati scaricati delle province attualmente selezionate che ricadono nell'area visibile.
- Il raggio della Classifica non limita la Mappa.
- Lo spostamento fuori dalle province configurate può produrre una mappa senza distributori ed è un comportamento previsto.
- La Mappa non scarica province aggiuntive.
- I marcatori mostrano almeno il prezzo e il relativo stato verde/giallo/rosso.
- È ammesso il clustering per mantenere leggibile la mappa in aree dense.
- Aprendo la Mappa dalla Classifica, il distributore scelto viene centrato ed evidenziato.

Interazione obbligatoria:

- il tocco su un distributore nella Mappa apre sempre direttamente l'applicazione di navigazione esterna configurata;
- non è richiesto un passaggio intermedio con scheda o popup di dettaglio.

## 12. Stati vuoti ed errori

Prevedere messaggi e azioni chiare almeno per:

- nessuna provincia configurata;
- province configurate ma dati non scaricati;
- aggiornamento disponibile;
- download in corso o fallito;
- GPS non autorizzato o non disponibile;
- coordinate manuali non valide;
- nessun distributore entro il raggio;
- carburante/modalità assente nei dati caricati;
- mappa spostata fuori dalle province disponibili;
- funzionamento offline con dati locali;
- nessun dato locale e assenza di rete.

## 13. Aspetto e accessibilità

- Design essenziale; schema cromatico generale libero.
- Verde, giallo e rosso sono riservati principalmente alla freschezza del prezzo.
- Il significato non deve dipendere dal solo colore: affiancare testo, icona o indicazione temporale.
- Controlli e righe devono avere aree di tocco adatte all'uso mobile.
- Contrasto leggibile e supporto delle dimensioni testo del dispositivo per quanto praticabile.
- Valori monetari in euro con tre decimali, coerenti con i prezzi carburante.
- Distanze espresse in chilometri con precisione adeguata.

## 14. Privacy e servizi esterni

La privacy non costituisce un vincolo architetturale specifico. Un disclaimer informa che geolocalizzazione, mappa e navigazione possono coinvolgere servizi esterni. La posizione non deve comunque essere salvata o trasmessa dal progetto se non è necessario alla funzione richiesta.

## 15. Struttura indicativa del repository

```text
/
  index.html
  styles.css
  app.js
  manifest.webmanifest
  service-worker.js
  assets/
  data/
    manifest.json
    <provincia>.json
  tools/
    update_data.py
    publish_data.sh
  tests/
  README.md
  SPEC.md
```

La struttura può essere leggermente adattata durante l'implementazione, purché non introduca complessità non motivata.

## 16. Criteri minimi di accettazione

La prima versione è accettabile quando:

1. il generatore locale produce JSON provinciali compatti per tutte le tipologie MIMIT e un manifest coerente;
2. una seconda esecuzione sugli stessi dati segnala correttamente “nessun aggiornamento” e non modifica i file;
3. la web app parte senza province e invita alla configurazione;
4. l'utente può scegliere province, carburante, modalità, raggio, soglie e navigatore;
5. vengono scaricati e conservati soltanto i dati pertinenti alle province configurate;
6. un aggiornamento remoto viene suggerito e scaricato solo su conferma;
7. la Classifica filtra e ordina correttamente usando la distanza geografica;
8. il tocco sulla riga della Classifica apre la Mappa interna sul distributore;
9. l'icona esterna della Classifica apre il navigatore configurato;
10. il tocco su un distributore nella Mappa apre sempre il navigatore configurato;
11. la Mappa mostra i record caricati presenti nell'area visibile e non carica automaticamente altre province;
12. colori ed età dei prezzi rispettano le soglie configurate;
13. l'app resta utilizzabile offline quando app shell e dati necessari sono già in cache;
14. la PWA può essere aggiunta alla schermata Home su iPhone e Android;
15. gli stati vuoti e gli errori principali hanno messaggi comprensibili e un'azione utile.

## 17. Fuori ambito per la prima versione

- account utente e sincronizzazione tra dispositivi;
- backend o database remoto interrogabile;
- selezione della posizione con tocco sulla mappa;
- download automatico di province non configurate;
- percorso o navigazione turn-by-turn interni alla web app;
- modifica manuale dei dati MIMIT;
- notifiche push;
- analytics, salvo decisione successiva esplicita.
