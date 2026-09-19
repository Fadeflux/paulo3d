// Les sites construits à partir du MÊME code (src/). Chaque site a ses propres données (projet Supabase
// séparé), sa langue, son logo, et ses propres noms dans le navigateur (prefix / id) : publiés à la même
// adresse de base (fadeflux.github.io), ils ne doivent JAMAIS lire ou effacer ce qui appartient à l'autre.
// ⚠️ Paulo3D garde ses noms d'origine (p3d / paulo3d) : les changer ferait perdre la session et les
//    actions en attente sur les appareils déjà installés.

// Lettres du logo, dessinées dans la boîte 26..104 × 22..98 (les couches d'impression vont de x=30 à 100)
const LETTERS = {
  P: 'M34 22H66C84 22 94 34 94 50C94 66 84 78 66 78H56V98H34ZM56 40V60H65C71 60 74 56 74 50C74 44 71 40 65 40Z',
  A: 'M52 22H78L100 98H80L75 80H55L50 98H30ZM59.5 64H70.5L65 43Z',
};

export const SITES = {
  paulo3d: {
    id: 'paulo3d',
    prefix: 'p3d',
    name: 'Paulo3D',
    lang: 'pt-PT',
    locale: 'pt-PT',
    letter: LETTERS.P,
    // base du site, inscrite dans l'appli : aucun lien ne peut la relier à une autre base (piège :
    // un faux lien #setup= menant à la base d'un pirate aurait capté mot de passe et code 2FA)
    supabase: { url: 'https://tjweersjswfuiutuqnvv.supabase.co', key: 'sb_publishable_EiMrFp8Usn-4W7iMfM0azQ_empCbI0B' },
    // double authentification exigée (la base l'exige aussi : supabase/durcissement.sql)
    mfaRequired: true,
    out: 'docs', // GitHub Pages : https://fadeflux.github.io/paulo3d/
    icons: 'src/icons',
    texts: {
      title: 'Paulo3D — Oficina de impressão 3D',
      tagline: 'Oficina de impressão 3D',
      description: 'Bobinas, custo de produção, produção, stock e vendas da oficina de impressão 3D.',
      noscript: 'O Paulo3D precisa de JavaScript para funcionar.',
      offline: 'Paulo3D: sem ligação e aplicação ainda não instalada neste aparelho.',
      shortcuts: ['Registar uma venda', 'Venda', 'Lançar uma produção', 'Produção', 'Bobinas', 'Bobinas'],
    },
  },
  anais3d: {
    id: 'anais3d',
    prefix: 'a3d',
    name: 'Anais3D',
    lang: 'fr',
    locale: 'fr-FR',
    letter: LETTERS.A,
    supabase: { url: 'https://jvfvbsiicctnuvdpjska.supabase.co', key: 'sb_publishable_83IKpTyF2IO4Z-1asWuQZg_LYFq2zZa' },
    mfaRequired: true,
    out: '../Anais3D/docs',
    icons: 'src/icons-anais3d',
    texts: {
      title: "Anais3D — Atelier d'impression 3D",
      tagline: "Atelier d'impression 3D",
      description: "Bobines, coûts de revient, production, stock et ventes de l'atelier d'impression 3D.",
      noscript: 'Anais3D a besoin de JavaScript pour fonctionner.',
      offline: 'Anais3D : pas de connexion et application pas encore installée sur cet appareil.',
      shortcuts: ['Enregistrer une vente', 'Vente', 'Lancer une production', 'Production', 'Bobines', 'Bobines'],
    },
  },
};

// Construction de test (tests automatiques, imitation locale) : le code tel qu'il est écrit, en français,
// avec les noms de Paulo3D
export const DEV_SITE = { ...SITES.paulo3d, lang: 'fr', locale: 'fr-FR', out: '.dev/site', texts: SITES.anais3d.texts, name: 'Paulo3D', supabase: null, mfaRequired: false };
DEV_SITE.texts = {
  ...SITES.anais3d.texts,
  title: "Paulo3D — Atelier d'impression 3D",
  noscript: 'Paulo3D a besoin de JavaScript pour fonctionner.',
  offline: 'Paulo3D : pas de connexion et application pas encore installée sur cet appareil.',
};
