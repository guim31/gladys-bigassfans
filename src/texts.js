// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys: connection status, the "Search for
// fans" report and the errors of the commands and scene actions. Four
// languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noDevice: {
    en: 'No Big Ass Fans device found. Check that it is on the same network as Gladys, or enter its IP address.',
    fr: "Aucun appareil Big Ass Fans trouvé. Vérifiez qu'il est sur le même réseau que Gladys, ou saisissez son adresse IP.",
    de: 'Kein Big-Ass-Fans-Gerät gefunden. Prüfe, ob es im selben Netzwerk wie Gladys ist, oder gib seine IP-Adresse ein.',
    es: 'No se ha encontrado ningún dispositivo Big Ass Fans. Compruebe que está en la misma red que Gladys o introduzca su dirección IP.',
  },
  noAnswer: {
    en: 'No Big Ass Fans device answers.',
    fr: 'Aucun appareil Big Ass Fans ne répond.',
    de: 'Kein Big-Ass-Fans-Gerät antwortet.',
    es: 'Ningún dispositivo Big Ass Fans responde.',
  },
};

// Errors a command or a scene action reports, in the configured language.
export const ERRORS = {
  unknownDevice: {
    en: 'Unknown Big Ass Fans device: run a search in the integration.',
    fr: "Appareil Big Ass Fans inconnu : lancez une recherche dans l'intégration.",
    de: 'Unbekanntes Big-Ass-Fans-Gerät: Starte eine Suche in der Integration.',
    es: 'Dispositivo Big Ass Fans desconocido: inicie una búsqueda en la integración.',
  },
  unreachable: {
    en: 'The device does not answer: check that it is powered and on the network.',
    fr: "L'appareil ne répond pas : vérifiez qu'il est alimenté et sur le réseau.",
    de: 'Das Gerät antwortet nicht: Prüfe, ob es Strom hat und im Netzwerk ist.',
    es: 'El dispositivo no responde: compruebe que está alimentado y conectado a la red.',
  },
  noFan: {
    en: 'This device has no fan.',
    fr: "Cet appareil n'a pas de ventilateur.",
    de: 'Dieses Gerät hat keinen Ventilator.',
    es: 'Este dispositivo no tiene ventilador.',
  },
  unsupported: {
    en: 'This device does not have this function.',
    fr: "Cet appareil n'a pas cette fonction.",
    de: 'Dieses Gerät hat diese Funktion nicht.',
    es: 'Este dispositivo no tiene esta función.',
  },
};

/** An Error whose message is in the configured language. */
export function localizedError(key, language) {
  const text = ERRORS[key] ?? ERRORS.unsupported;
  const error = new Error(text[language] ?? text.en);
  error.code = key;
  return error;
}

const MAX_LISTED = 8;

// The pieces of the "Search" report, one table per language.
export const SEARCH_TEXT = {
  en: {
    none: 'No Big Ass Fans device found.',
    count: (total, reachable) => `${total} device(s), ${reachable} answering:`,
    unreachable: 'not answering',
    unavailable:
      'Automatic discovery through Gladys is unavailable (Gladys 5.1 or later needed): enter the IP addresses.',
    busy: 'A search is already running: try again in a few seconds.',
    ignored: (list) => `Ignored addresses: ${list}.`,
    silent: (list) => `No answer at ${list}.`,
  },
  fr: {
    none: 'Aucun appareil Big Ass Fans trouvé.',
    count: (total, reachable) => `${total} appareil(s), ${reachable} répondent :`,
    unreachable: 'ne répond pas',
    unavailable:
      'La découverte automatique par Gladys est indisponible (Gladys 5.1 ou plus récent) : saisissez les adresses IP.',
    busy: 'Une recherche est déjà en cours : réessayez dans quelques secondes.',
    ignored: (list) => `Adresses ignorées : ${list}.`,
    silent: (list) => `Pas de réponse à ${list}.`,
  },
  de: {
    none: 'Kein Big-Ass-Fans-Gerät gefunden.',
    count: (total, reachable) => `${total} Gerät(e), davon ${reachable} erreichbar:`,
    unreachable: 'antwortet nicht',
    unavailable:
      'Die automatische Erkennung über Gladys ist nicht verfügbar (Gladys 5.1 oder neuer nötig): Gib die IP-Adressen ein.',
    busy: 'Es läuft bereits eine Suche: Versuche es in ein paar Sekunden erneut.',
    ignored: (list) => `Ignorierte Adressen: ${list}.`,
    silent: (list) => `Keine Antwort von ${list}.`,
  },
  es: {
    none: 'No se ha encontrado ningún dispositivo Big Ass Fans.',
    count: (total, reachable) => `${total} dispositivo(s), ${reachable} responden:`,
    unreachable: 'no responde',
    unavailable:
      'El descubrimiento automático a través de Gladys no está disponible (se necesita Gladys 5.1 o posterior): introduzca las direcciones IP.',
    busy: 'Ya hay una búsqueda en curso: inténtelo de nuevo en unos segundos.',
    ignored: (list) => `Direcciones ignoradas: ${list}.`,
    silent: (list) => `Sin respuesta en ${list}.`,
  },
};

/** The report shown under the "Search" button, in every language. */
export function searchMessage(summary) {
  return Object.fromEntries(
    Object.entries(SEARCH_TEXT).map(([language, text]) => [language, searchReport(summary, text)]),
  );
}

function searchReport({ devices, scan, invalidHosts, silentHosts = [] }, text) {
  const lines = [];
  if (devices.length === 0) {
    lines.push(text.none);
  } else {
    const reachable = devices.filter((device) => device.reachable).length;
    lines.push(text.count(devices.length, reachable));
    // The first ones: the message stays readable under the button.
    const list = devices
      .slice(0, MAX_LISTED)
      .map(
        ({ name, host, model, reachable: up }) =>
          `${name} (${host}${model ? `, ${model}` : ''}${up ? '' : `, ${text.unreachable}`})`,
      );
    lines.push(`${list.join(', ')}${devices.length > MAX_LISTED ? '…' : '.'}`);
  }
  if (scan === 'unavailable') {
    lines.push(text.unavailable);
  } else if (scan === 'busy') {
    lines.push(text.busy);
  }
  if (silentHosts.length > 0) {
    lines.push(text.silent(silentHosts.slice(0, 3).join(', ')));
  }
  if (invalidHosts.length > 0) {
    lines.push(text.ignored(invalidHosts.slice(0, 3).join(', ')));
  }
  return lines.join(' ');
}
