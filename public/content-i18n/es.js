import { terms } from './es-terms.js';

// https://www.pokemon.com/es/jcc-pokemon/cartas-pokemon/
// https://www.wikidex.net/wiki/Categoría:Lista_de_mazos_del_JCC
export const sets = {
  base: 'Edición Básica',
  jungle: 'Jungla',
  fossil: 'Fósil',
  // Project translations for historical expansions without a Spanish release name.
  base2: 'Edición Básica 2',
  gym1: 'Héroes de Gimnasio',
  gym2: 'Desafío de Gimnasio',
  rocket: 'Team Rocket',
  sm: 'Sol y Luna',
  swsh: 'Espada y Escudo',
  sv: 'Escarlata y Púrpura',
  mega: 'Megaevolución',
  celebration: 'Celebración 30.º Aniversario',
  chaosRising: 'Caos Creciente',
  vividVoltage: 'Voltaje Vívido',
  unbrokenBonds: 'Vínculos Indestructibles',
};

const person = {
  ghetsis: 'Ghechis',
  'lt-surge': terms.card['Lt. Surge'],
  marnie: terms.card.Marnie,
  professorSada: 'Profesora Albora',
  professorTuro: 'Profesor Turo',
  steven: 'Máximo',
};

const league = card => `Baraja Combate de Liga de ${card}`;

export const names = {
  ...terms,
  attack: { ...terms.attack, 'Tongue Slap': 'Golpe de Lengua' },
  person,
  deck: {
    // Spanish retail names for the original Base Set, Jungle and Fossil decks.
    brushfire: 'Quemabosques',
    overgrowth: 'Supercrecimiento',
    zap: '¡Zap!',
    blackout: 'Apagón',
    'water-blast': 'Tromba de Agua',
    'power-reserve': 'Reserva de Poder',
    lockdown: 'Encierro',
    bodyguard: 'Guardaespaldas',

    // WikiDex names for English releases, alongside their original titles.
    // https://www.wikidex.net/wiki/Categoría:Lista_de_mazos_del_JCC
    'grass-chopper': 'Cortador de Hierba (Grass Chopper)',
    'hot-water': 'Agua Caliente (Hot Water)',
    'lightning-bug': 'Bicho Eléctrico (Lightning Bug)',
    'psych-out': 'Desestabilizador (Psych Out)',
    devastation: 'Devastación (Devastation)',
    trouble: 'Problemas (Trouble)',
    'gym-brock': "Baraja de Brock (Brock's Rock)",
    'gym-misty': "Baraja de Misty (Misty's Water)",
    'lt-surge': `Baraja del ${person['lt-surge']} (Lt. Surge's Lightning)`,
    erika: "Baraja de Erika (Erika's Garden)",
    sabrina: "Baraja de Sabrina (Sabrina's Psychic)",
    koga: "Baraja de Koga (Koga's Poison)",
    blaine: "Baraja de Blaine (Blaine's Fire)",
    giovanni: "Baraja de Giovanni (Giovanni's Earth)",

    // https://www.wikidex.net/wiki/Sol_y_Luna_(TCG):_Sol_y_Luna
    // https://www.wikidex.net/wiki/Sol_y_Luna_(TCG):_Unión_de_Aliados
    'sm-forest-shadow': 'Sombra Forestal',
    'sm-roaring-heat': 'Calor Rugiente',
    'sm-bright-tide': 'Marea Luminosa',
    'sm-steel-sun': 'Sol Acerado',
    'sm-hidden-moon': 'Luna Oculta',
    'sm-rock-steady': 'Rocas Afiladas',
    'sm-luminous-frost': 'Escarcha Luminosa',
    'sm-destruction-fang': 'Colmillos Destructores',
    'sm-clanging-thunder': 'Truenos Estrepitosos',
    'sm-mach-strike': 'Impacto Mach',
    'sm-imperial-command': 'Orden Imperial',
    'sm-tropical-takedown': 'Derribo Tropical',
    'sm-twilight-rogue': 'Ocaso Solitario',
    'sm-leaf-charge': 'Hoja Eléctrica',
    'sm-hydro-fury': 'Furia Acuática',
    'sm-storm-caller': 'Invocador de Tormentas',
    'sm-blazing-volcano': 'Volcán en Llamas',
    'sm-relentless-flame': 'Llama Implacable',
    'sm-torrential-cannon': 'Cañón Torrencial',
    'sm-lightning-loop': 'Circuito Fulminante',
    'sm-battle-mind': 'Combate Mental',

    // Project translations from the original English deck titles.
    thunderstorm: 'Tormenta Eléctrica (Thunderstorm)',
    'sm-let-s-play-pikachu': "¡A jugar, Pikachu! (Let's Play, Pikachu!)",
    'sm-let-s-play-eevee': "¡A jugar, Eevee! (Let's Play, Eevee!)",

    // Deck labels based on the Pokémon or Trainer featured on the product.
    'me-gengar': terms.card['Mega Gengar ex'],
    'me-diancie': terms.card['Mega Diancie ex'],
    'mel-lucario': league(terms.card['Mega Lucario ex']),
    'mel-greninja': league(terms.card['Mega Greninja ex']),
    'sv-marnie': person.marnie,
    'sv-steven': person.steven,
    'sv-iron-leaves': terms.card['Iron Leaves ex'],
    'svl-miraidon': league('Miraidon ex'),
    'svl-gardevoir': league('Gardevoir ex'),
    'svl-charizard': league('Charizard ex'),
    'svl-dragapult': league('Dragapult ex'),
    'svl-mewtwo': league(terms.card["Team Rocket's Mewtwo ex"]),
    'swsh-darmanitan': terms.card['Galarian Darmanitan'],
    'swsh-sirfetchd': terms.card["Galarian Sirfetch'd"],
    'swl-zacian': league('Zacian V'),
    'swl-urshifu-rapid': terms.card['Rapid Strike Urshifu VMAX'],
    'swl-urshifu-single': terms.card['Single Strike Urshifu VMAX'],
    'swl-calyrex-ice': terms.card['Ice Rider Calyrex VMAX'],
    'swl-calyrex-shadow': terms.card['Shadow Rider Calyrex VMAX'],
    'swl-palkia': terms.card['Origin Forme Palkia VSTAR'],
  },
};
