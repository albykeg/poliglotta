# Poliglotta – Traduttore per Messenger

Estensione per Chrome (funziona anche su Edge e Brave) che traduce le chat di Messenger su Facebook.
Gratis, senza chiavi API, senza limiti di caratteri.

## Cosa fa

- **Messaggi ricevuti**: la traduzione nella tua lingua compare sotto l'originale, dentro la stessa bolla.
- **Lingua di ogni chat riconosciuta da sola**: guarda gli ultimi messaggi ricevuti e la ricorda per quella chat.
- **Le tue risposte**: scrivi in italiano e premi **Invio** → il testo viene tradotto nella casella.
  Controlli e premi **Invio** di nuovo per inviare. **Esc** riporta l'italiano.
- **La formattazione resta com'è**: a capo, righe vuote, elenchi (•, -, 1.), emoji,
  `*grassetto*`, `_corsivo_`, `~barrato~`. I `codici` tra apici inversi e i blocchi tra ``` non vengono tradotti.
- **Link e nomi non vengono mai tradotti né trascritti** (es. in russo "Marco" resta "Marco", non "Марко"):
  - sempre protetti: link, siti (projet-hub.com), email, @menzioni, #hashtag;
  - nomi: quelli con la maiuscola a metà frase ("Ciao Marco"), i nomi doppi ("Michele Monaco"),
    il nome della persona con cui chatti, e le parole della lista **Mai tradurre** (icona dell'estensione;
    "Projet" è già inserito);
  - un nome singolo a **inizio frase** ("Michele ti chiama domani") non si distingue da una parola normale:
    se ti capita spesso, aggiungilo alla lista.
  - Dopo ogni traduzione l'estensione controlla che link e nomi siano identici; se no, ritraduce a pezzi.
  - Restano tradotti: "Gentile Cliente", "La/Le" di cortesia, luoghi e feste (Europa, Natale), il TESTO URLATO.
- Se scrivi già nella lingua del cliente, non cambia nulla.
- Funziona su facebook.com/messages, nelle chat a bolla della home di Facebook e su messenger.com.

## Installazione (2 minuti)

1. Estrai lo zip in una cartella che non cancellerai (es. `Documenti/Poliglotta`).
2. Apri Chrome e vai su `chrome://extensions`.
3. Attiva **Modalità sviluppatore** (in alto a destra).
4. Clicca **Carica estensione non pacchettizzata** e scegli la cartella `poliglotta`.
5. Fissa l'icona nella barra (puzzle 🧩 → spillo) e ricarica Facebook.

## Aggiornamenti

Quando esce una nuova versione, l'icona di Poliglotta mostra un **pallino rosso** e il popup spiega cosa fare.

- **Windows:** doppio clic su **Aggiorna Poliglotta** in questa cartella.
  Per non pensarci più: doppio clic, una volta, su **Aggiornamenti automatici** (controlla e scarica da solo ogni giorno;
  rifai doppio clic per disattivarli).
- **Mac:** doppio clic su **Aggiorna Poliglotta.command** (la prima volta: clic destro → Apri).
- Poi chiudi e riapri Chrome (oppure ↻ **Ricarica** su Poliglotta in `chrome://extensions`) e premi F5 su Facebook.
- Le impostazioni restano: l'aggiornamento sostituisce solo i file in questa stessa cartella.
  **Non spostare e non rinominare la cartella**, altrimenti Chrome la considera un'estensione nuova.

## Uso

- Sopra la casella di scrittura compare l'etichetta **🌐 IT → DE**: è la lingua in cui verranno tradotte le tue risposte.
- Dal menu dell'etichetta puoi:
  - lasciare **Automatico** (consigliato);
  - fissare una lingua a mano per quella chat;
  - scegliere **Non tradurre questa chat** (es. clienti italiani).
- **Alt+T**: attiva o disattiva tutto al volo.
- Dall'icona dell'estensione: la tua lingua, cosa tradurre, caratteri tradotti oggi.

## Come funziona e limiti

- Usa i canali gratuiti di Google Translate direttamente dal tuo browser, come le estensioni di traduzione gratuite.
  Le richieste partono dal tuo computer: nessun server in mezzo e nessuna chiave a tuo nome.
- Più messaggi vengono tradotti in una sola richiesta e i risultati restano in memoria, così le chiamate sono poche.
- Non è un servizio ufficiale: per uso normale non ci sono blocchi. Con volumi enormi Google può rallentare per qualche minuto.
  In quel caso l'estensione prova un secondo canale e, se Chrome ce l'ha, il traduttore integrato nel computer.
- Facebook cambia spesso la sua pagina. Se un giorno qualcosa smette di funzionare, serve un piccolo aggiornamento.
- Nell'app Messenger del telefono le estensioni non funzionano.

## Problemi comuni

- **Non vedo le traduzioni**: ricarica la pagina (F5) dopo aver installato o aggiornato l'estensione.
- **"Poliglotta è stata aggiornata: ricarica la pagina"**: premi F5.
- **Ancora niente traduzioni**: apri la chat, clicca l'icona di Poliglotta → **Copia diagnostica** e incolla il risultato a Claude (non contiene il testo dei messaggi).
- **La lingua rilevata è sbagliata**: sceglila a mano dal menu 🌐 per quella chat.

## File

| File | Cosa fa |
|---|---|
| `manifest.json` | configurazione dell'estensione |
| `background.js` | chiamate a Google, cache, statistiche |
| `content.js` | logica dentro Facebook/Messenger |
| `format.js` | conserva la formattazione durante la traduzione |
| `content.css` | stile della traduzione sotto i messaggi |
| `languages.js` | elenco lingue |
| `popup.*` | finestra delle impostazioni |
| `update.json` | dove sono pubblicati gli aggiornamenti (GitHub) |
| `aggiorna.ps1`, `*.bat`, `*.command` | script di aggiornamento |
