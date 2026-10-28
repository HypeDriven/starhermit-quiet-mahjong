// StarHermit account strings (sign in, invite, the leaderboard line) and the
// action names the controls line shows, in every shipping locale, looked up in
// the game language (the browser build's js/gfx-i18n.js PLATFORM table).
const PLATFORM = {
  en: {
    signIn: 'Sign in with StarHermit', invite: 'Invite a friend',
    inviteCopied: 'Invite link copied to the clipboard.', inviteLink: 'Invite link: {url}',
    signedOut: 'Signed out of StarHermit — progress is kept on this device.',
    lbPosting: 'Posting score to the leaderboard…',
    lbRank: 'Leaderboard rank: #{rank}',
    lbPosted: 'Score posted to the leaderboard.',
    lbNotPosted: 'Score not posted to the leaderboard.',
    act_up: 'Up', act_down: 'Down', act_left: 'Left', act_right: 'Right', act_select: 'Select',
    act_pause: 'Pause', act_hint: 'Hint', act_undo: 'Undo', act_shuffle: 'Shuffle', act_camera: 'Reset camera',
    keyboard: 'Keyboard',
  },
  es: {
    signIn: 'Iniciar sesión con StarHermit', invite: 'Invitar a un amigo',
    inviteCopied: 'Enlace de invitación copiado al portapapeles.', inviteLink: 'Enlace de invitación: {url}',
    signedOut: 'Se cerró la sesión de StarHermit; el progreso se guarda en este dispositivo.',
    lbPosting: 'Enviando la puntuación a la clasificación…',
    lbRank: 'Puesto en la clasificación: #{rank}',
    lbPosted: 'Puntuación enviada a la clasificación.',
    lbNotPosted: 'La puntuación no se envió a la clasificación.',
    act_up: 'Arriba', act_down: 'Abajo', act_left: 'Izquierda', act_right: 'Derecha', act_select: 'Seleccionar',
    act_pause: 'Pausa', act_hint: 'Pista', act_undo: 'Deshacer', act_shuffle: 'Barajar', act_camera: 'Restablecer cámara',
    keyboard: 'Teclado',
  },
  de: {
    signIn: 'Mit StarHermit anmelden', invite: 'Freund einladen',
    inviteCopied: 'Einladungslink in die Zwischenablage kopiert.', inviteLink: 'Einladungslink: {url}',
    signedOut: 'Von StarHermit abgemeldet – der Fortschritt bleibt auf diesem Gerät.',
    lbPosting: 'Punktzahl wird an die Bestenliste gesendet…',
    lbRank: 'Platz in der Bestenliste: #{rank}',
    lbPosted: 'Punktzahl an die Bestenliste gesendet.',
    lbNotPosted: 'Punktzahl wurde nicht an die Bestenliste gesendet.',
    act_up: 'Hoch', act_down: 'Runter', act_left: 'Links', act_right: 'Rechts', act_select: 'Auswählen',
    act_pause: 'Pause', act_hint: 'Tipp', act_undo: 'Rückgängig', act_shuffle: 'Mischen', act_camera: 'Kamera zurücksetzen',
    keyboard: 'Tastatur',
  },
  fr: {
    signIn: 'Se connecter avec StarHermit', invite: 'Inviter un ami',
    inviteCopied: 'Lien d’invitation copié dans le presse-papiers.', inviteLink: 'Lien d’invitation : {url}',
    signedOut: 'Déconnecté de StarHermit — la progression reste sur cet appareil.',
    lbPosting: 'Envoi du score au classement…',
    lbRank: 'Rang au classement : #{rank}',
    lbPosted: 'Score envoyé au classement.',
    lbNotPosted: 'Score non envoyé au classement.',
    act_up: 'Haut', act_down: 'Bas', act_left: 'Gauche', act_right: 'Droite', act_select: 'Sélectionner',
    act_pause: 'Pause', act_hint: 'Indice', act_undo: 'Annuler', act_shuffle: 'Mélanger', act_camera: 'Réinitialiser la caméra',
    keyboard: 'Clavier',
  },
  pt: {
    signIn: 'Entrar com StarHermit', invite: 'Convidar um amigo',
    inviteCopied: 'Link de convite copiado para a área de transferência.', inviteLink: 'Link de convite: {url}',
    signedOut: 'Você saiu do StarHermit — o progresso fica salvo neste dispositivo.',
    lbPosting: 'Enviando a pontuação para o ranking…',
    lbRank: 'Posição no ranking: #{rank}',
    lbPosted: 'Pontuação enviada ao ranking.',
    lbNotPosted: 'Pontuação não enviada ao ranking.',
    act_up: 'Cima', act_down: 'Baixo', act_left: 'Esquerda', act_right: 'Direita', act_select: 'Selecionar',
    act_pause: 'Pausar', act_hint: 'Dica', act_undo: 'Desfazer', act_shuffle: 'Embaralhar', act_camera: 'Redefinir câmera',
    keyboard: 'Teclado',
  },
  it: {
    signIn: 'Accedi con StarHermit', invite: 'Invita un amico',
    inviteCopied: 'Link di invito copiato negli appunti.', inviteLink: 'Link di invito: {url}',
    signedOut: 'Disconnesso da StarHermit: i progressi restano su questo dispositivo.',
    lbPosting: 'Invio del punteggio alla classifica…',
    lbRank: 'Posizione in classifica: #{rank}',
    lbPosted: 'Punteggio inviato alla classifica.',
    lbNotPosted: 'Punteggio non inviato alla classifica.',
    act_up: 'Su', act_down: 'Giù', act_left: 'Sinistra', act_right: 'Destra', act_select: 'Seleziona',
    act_pause: 'Pausa', act_hint: 'Indizio', act_undo: 'Annulla', act_shuffle: 'Mescola', act_camera: 'Ripristina visuale',
    keyboard: 'Tastiera',
  },
};

const BY_LOCALE = { 'en-US': 'en', 'en-GB': 'en', 'es-419': 'es', 'es-ES': 'es', 'de-DE': 'de', 'fr-FR': 'fr', 'fr-CA': 'fr', 'pt-BR': 'pt', 'it-IT': 'it' };
const FR_CA = { lbPosted: 'Pointage envoyé au classement.', lbNotPosted: 'Pointage non envoyé au classement.', lbPosting: 'Envoi du pointage au classement…' };
export const SH_LOCALES = Object.keys(BY_LOCALE);
/** The account strings for a locale (English for an unknown one). */
export function shStrings(locale) {
  const base = PLATFORM[BY_LOCALE[locale] || 'en'];
  return locale === 'fr-CA' ? { ...base, ...FR_CA } : base;
}
