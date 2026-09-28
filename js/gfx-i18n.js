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
