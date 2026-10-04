/**
 * Quiet Mahjong — strings for the Graphics settings panel, per locale.
 * The locale comes from navigator.language (the game has no language setting).
 */

const en = {
  settings: 'Settings', back: 'Back', graphics: 'Graphics', quality: 'Quality',
  auto: 'Auto (detected: {tier})', fromPreset: 'From preset ({tier})',
  low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', medium: 'Medium',
  off: 'Off', on: 'On', static: 'Static', animated: 'Animated', plain: 'Plain', detailed: 'Detailed',
  renderScale: 'Render scale', adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  cat_shadows: 'Shadows', cat_ao: 'Ambient occlusion', cat_bloom: 'Bloom', cat_grade: 'Color grade',
  cat_antialias: 'Anti-aliasing', cat_reflections: 'Reflections', cat_detail: 'Detail',
  cat_particles: 'Match particles', cat_background: 'Ambient motion',
  postUnavailable: 'Post-processing is unavailable on this device; effects are off.',
  unknownGpu: 'unknown GPU',
  noShadows: 'no shadows', shadowsN: '{n}² shadows', ao: 'ambient occlusion', aoFull: 'full ambient occlusion',
  bloomS: 'bloom', reflectionsS: 'reflections', noAa: 'no anti-aliasing',
};

const STRINGS = {
  en,
  'en-GB': { ...en, cat_grade: 'Colour grade' },
  es: {
    settings: 'Ajustes', back: 'Volver', graphics: 'Gráficos', quality: 'Calidad',
    auto: 'Automática (detectada: {tier})', fromPreset: 'Según ajuste ({tier})',
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Media',
    off: 'No', on: 'Sí', static: 'Estático', animated: 'Animado', plain: 'Sencillo', detailed: 'Detallado',
    renderScale: 'Escala de renderizado', adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
    cat_shadows: 'Sombras', cat_ao: 'Oclusión ambiental', cat_bloom: 'Resplandor', cat_grade: 'Corrección de color',
    cat_antialias: 'Antialiasing', cat_reflections: 'Reflejos', cat_detail: 'Detalle',
    cat_particles: 'Partículas al emparejar', cat_background: 'Movimiento ambiental',
    postUnavailable: 'El posprocesado no está disponible en este dispositivo; los efectos están desactivados.',
    unknownGpu: 'GPU desconocida',
    noShadows: 'sin sombras', shadowsN: 'sombras {n}²', ao: 'oclusión ambiental', aoFull: 'oclusión ambiental completa',
    bloomS: 'resplandor', reflectionsS: 'reflejos', noAa: 'sin antialiasing',
  },
  de: {
    settings: 'Einstellungen', back: 'Zurück', graphics: 'Grafik', quality: 'Qualität',
    auto: 'Automatisch (erkannt: {tier})', fromPreset: 'Laut Voreinstellung ({tier})',
    low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra', medium: 'Mittel',
    off: 'Aus', on: 'An', static: 'Statisch', animated: 'Animiert', plain: 'Einfach', detailed: 'Detailliert',
    renderScale: 'Renderskalierung', adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    cat_shadows: 'Schatten', cat_ao: 'Umgebungsverdeckung', cat_bloom: 'Leuchteffekt', cat_grade: 'Farbkorrektur',
    cat_antialias: 'Kantenglättung', cat_reflections: 'Spiegelungen', cat_detail: 'Details',
    cat_particles: 'Partikel bei Paaren', cat_background: 'Umgebungsbewegung',
    postUnavailable: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; Effekte sind aus.',
    unknownGpu: 'unbekannte GPU',
    noShadows: 'keine Schatten', shadowsN: '{n}²-Schatten', ao: 'Umgebungsverdeckung', aoFull: 'volle Umgebungsverdeckung',
    bloomS: 'Leuchteffekt', reflectionsS: 'Spiegelungen', noAa: 'keine Kantenglättung',
  },
  fr: {
    settings: 'Paramètres', back: 'Retour', graphics: 'Graphismes', quality: 'Qualité',
    auto: 'Automatique (détectée : {tier})', fromPreset: 'Selon le préréglage ({tier})',
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra', medium: 'Moyenne',
    off: 'Non', on: 'Oui', static: 'Statique', animated: 'Animé', plain: 'Simple', detailed: 'Détaillé',
    renderScale: 'Échelle de rendu', adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
    cat_shadows: 'Ombres', cat_ao: 'Occlusion ambiante', cat_bloom: 'Halo lumineux', cat_grade: 'Étalonnage des couleurs',
    cat_antialias: 'Anticrénelage', cat_reflections: 'Reflets', cat_detail: 'Détails',
    cat_particles: 'Particules des paires', cat_background: 'Mouvement ambiant',
    postUnavailable: 'Le post-traitement est indisponible sur cet appareil ; les effets sont désactivés.',
    unknownGpu: 'GPU inconnu',
    noShadows: 'sans ombres', shadowsN: 'ombres {n}²', ao: 'occlusion ambiante', aoFull: 'occlusion ambiante complète',
    bloomS: 'halo', reflectionsS: 'reflets', noAa: 'sans anticrénelage',
  },
  pt: {
    settings: 'Configurações', back: 'Voltar', graphics: 'Gráficos', quality: 'Qualidade',
    auto: 'Automática (detectada: {tier})', fromPreset: 'Da predefinição ({tier})',
    low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Média',
    off: 'Não', on: 'Sim', static: 'Estático', animated: 'Animado', plain: 'Simples', detailed: 'Detalhado',
    renderScale: 'Escala de renderização', adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
    cat_shadows: 'Sombras', cat_ao: 'Oclusão de ambiente', cat_bloom: 'Brilho', cat_grade: 'Correção de cor',
    cat_antialias: 'Antisserrilhamento', cat_reflections: 'Reflexos', cat_detail: 'Detalhe',
    cat_particles: 'Partículas dos pares', cat_background: 'Movimento ambiente',
    postUnavailable: 'O pós-processamento não está disponível neste dispositivo; os efeitos estão desligados.',
    unknownGpu: 'GPU desconhecida',
    noShadows: 'sem sombras', shadowsN: 'sombras {n}²', ao: 'oclusão de ambiente', aoFull: 'oclusão de ambiente completa',
    bloomS: 'brilho', reflectionsS: 'reflexos', noAa: 'sem antisserrilhamento',
  },
  it: {
    settings: 'Impostazioni', back: 'Indietro', graphics: 'Grafica', quality: 'Qualità',
    auto: 'Automatica (rilevata: {tier})', fromPreset: 'Da preimpostazione ({tier})',
    low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra', medium: 'Media',
    off: 'No', on: 'Sì', static: 'Statico', animated: 'Animato', plain: 'Semplice', detailed: 'Dettagliato',
    renderScale: 'Scala di rendering', adaptive: 'Risoluzione adattiva', showFps: 'Mostra frame rate',
    cat_shadows: 'Ombre', cat_ao: 'Occlusione ambientale', cat_bloom: 'Bagliore', cat_grade: 'Correzione colore',
    cat_antialias: 'Antialiasing', cat_reflections: 'Riflessi', cat_detail: 'Dettaglio',
    cat_particles: 'Particelle delle coppie', cat_background: 'Movimento ambientale',
    postUnavailable: 'La post-elaborazione non è disponibile su questo dispositivo; gli effetti sono disattivati.',
    unknownGpu: 'GPU sconosciuta',
    noShadows: 'nessuna ombra', shadowsN: 'ombre {n}²', ao: 'occlusione ambientale', aoFull: 'occlusione ambientale completa',
    bloomS: 'bagliore', reflectionsS: 'riflessi', noAa: 'nessun antialiasing',
  },
};
// StarHermit platform chrome (sign-in, invite link, keyboard bindings).
const PLATFORM = {
  en: {
    signIn: 'Sign in with StarHermit', invite: 'Invite a friend',
    inviteCopied: 'Invite link copied to the clipboard.', inviteLink: 'Invite link: {url}',
    signedOut: 'Signed out of StarHermit — progress is kept on this device.',
    act_up: 'Up', act_down: 'Down', act_left: 'Left', act_right: 'Right', act_select: 'Select',
    act_pause: 'Pause', act_hint: 'Hint', act_undo: 'Undo', act_shuffle: 'Shuffle', act_camera: 'Reset camera',
    keyboard: 'Keyboard',
  },
  es: {
    signIn: 'Iniciar sesión con StarHermit', invite: 'Invitar a un amigo',
    inviteCopied: 'Enlace de invitación copiado al portapapeles.', inviteLink: 'Enlace de invitación: {url}',
    signedOut: 'Se cerró la sesión de StarHermit; el progreso se guarda en este dispositivo.',
    act_up: 'Arriba', act_down: 'Abajo', act_left: 'Izquierda', act_right: 'Derecha', act_select: 'Seleccionar',
    act_pause: 'Pausa', act_hint: 'Pista', act_undo: 'Deshacer', act_shuffle: 'Barajar', act_camera: 'Restablecer cámara',
    keyboard: 'Teclado',
  },
  de: {
    signIn: 'Mit StarHermit anmelden', invite: 'Freund einladen',
    inviteCopied: 'Einladungslink in die Zwischenablage kopiert.', inviteLink: 'Einladungslink: {url}',
    signedOut: 'Von StarHermit abgemeldet – der Fortschritt bleibt auf diesem Gerät.',
    act_up: 'Hoch', act_down: 'Runter', act_left: 'Links', act_right: 'Rechts', act_select: 'Auswählen',
    act_pause: 'Pause', act_hint: 'Tipp', act_undo: 'Rückgängig', act_shuffle: 'Mischen', act_camera: 'Kamera zurücksetzen',
    keyboard: 'Tastatur',
  },
  fr: {
    signIn: 'Se connecter avec StarHermit', invite: 'Inviter un ami',
    inviteCopied: 'Lien d’invitation copié dans le presse-papiers.', inviteLink: 'Lien d’invitation : {url}',
    signedOut: 'Déconnecté de StarHermit — la progression reste sur cet appareil.',
    act_up: 'Haut', act_down: 'Bas', act_left: 'Gauche', act_right: 'Droite', act_select: 'Sélectionner',
    act_pause: 'Pause', act_hint: 'Indice', act_undo: 'Annuler', act_shuffle: 'Mélanger', act_camera: 'Réinitialiser la caméra',
    keyboard: 'Clavier',
  },
  pt: {
    signIn: 'Entrar com StarHermit', invite: 'Convidar um amigo',
    inviteCopied: 'Link de convite copiado para a área de transferência.', inviteLink: 'Link de convite: {url}',
    signedOut: 'Você saiu do StarHermit — o progresso fica salvo neste dispositivo.',
    act_up: 'Cima', act_down: 'Baixo', act_left: 'Esquerda', act_right: 'Direita', act_select: 'Selecionar',
    act_pause: 'Pausar', act_hint: 'Dica', act_undo: 'Desfazer', act_shuffle: 'Embaralhar', act_camera: 'Redefinir câmera',
    keyboard: 'Teclado',
  },
  it: {
    signIn: 'Accedi con StarHermit', invite: 'Invita un amico',
    inviteCopied: 'Link di invito copiato negli appunti.', inviteLink: 'Link di invito: {url}',
    signedOut: 'Disconnesso da StarHermit: i progressi restano su questo dispositivo.',
    act_up: 'Su', act_down: 'Giù', act_left: 'Sinistra', act_right: 'Destra', act_select: 'Seleziona',
    act_pause: 'Pausa', act_hint: 'Suggerimento', act_undo: 'Annulla', act_shuffle: 'Mescola', act_camera: 'Ripristina visuale',
    keyboard: 'Tastiera',
  },
};
for (const [k, v] of Object.entries(PLATFORM)) Object.assign(STRINGS[k], v);
Object.assign(STRINGS['en-GB'], PLATFORM.en);

// Regional variants that differ only in a few words.
STRINGS['es-ES'] = { ...STRINGS.es, renderScale: 'Escala de renderizado', cat_antialias: 'Suavizado de bordes', noAa: 'sin suavizado' };
STRINGS['es-419'] = STRINGS.es;
STRINGS['fr-CA'] = { ...STRINGS.fr, settings: 'Réglages' };
STRINGS['pt-BR'] = STRINGS.pt;

export const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];

/** Pick the string table for a BCP-47 tag: exact region, then language, then English. */
export function stringsFor(tag) {
  const t = String(tag || 'en').replace('_', '-');
  const [lang] = t.split('-');
  const l = lang.toLowerCase();
  const exact = Object.keys(STRINGS).find(k => k.toLowerCase() === t.toLowerCase());
  if (exact) return STRINGS[exact];
  if (l === 'en' && /-(gb|au|nz|ie|za|in)$/i.test(t)) return STRINGS['en-GB'];
  if (l === 'es' && !/-es$/i.test(t)) return STRINGS['es-419'];
  return STRINGS[l] || en;
}

/** Translator: `tr('auto', { tier: 'Low' })`. */
export function translator(tag) {
  const s = stringsFor(tag);
  return (key, vars) => {
    let v = s[key] ?? en[key] ?? key;
    if (vars) for (const [k, x] of Object.entries(vars)) v = v.replace(`{${k}}`, x);
    return v;
  };
}
