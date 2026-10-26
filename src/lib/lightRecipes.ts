import { norm } from './text'
import { ingredientLabel, parseIngredient, SEED_RECIPES, type Seed } from './recipes'
import type { Ingredient, Recipe } from './types'

// Recetas ligeras (pérdida de peso, solo Mike; Silvia come normal y añade hidrato en
// las cenas). Las cremas listas de microondas van solo a la comida, nunca a la cena.
// Cantidades por ración. Doc de referencia: «Recetas ligeras para el menú» (26-10-2026).

const crema = (name: string, crema: string, side: string[], steps: string, prep: number, equipment: Seed['equipment']): Seed => ({
  name, slot: 'comida', prep_min: prep, equipment, tags: ['ligera', 'crema', 'tupper', 'microondas'], steps,
  ingredients: [`300 ml ${crema}`, ...side],
})

export const LIGHT_RECIPES: Seed[] = [
  // Cremas para la comida (siempre con proteína al lado)
  crema('Crema de calabaza con tortilla de claras', 'Crema de calabaza', ['1 ud Huevos', '70 ml Claras de huevo', '40 g Espinacas', '* Aceite de oliva'],
    'Tortilla de huevo, claras y espinacas la noche antes. Calienta la crema 2-3 min al microondas.', 10, 'fuego'),
  crema('Crema de verduras con pavo a la plancha', 'Crema de verduras', ['120 g Pechuga de pavo', '1 ud Tomates', '* Aceite de oliva'],
    'Pavo a la plancha y tomate aliñado aparte. Calienta la crema 2-3 min.', 10, 'fuego'),
  crema('Crema de calabacín con huevo duro y pollo', 'Crema de calabacín', ['1 ud Huevos', '60 g Pollo asado'],
    'Huevo cocido y pollo desmenuzado por encima de la crema caliente.', 5, 'microondas'),
  crema('Crema de zanahoria con merluza', 'Crema de zanahoria', ['150 g Merluza', '0,25 ud Limones'],
    'Merluza con limón tapada 5 min al microondas. Calienta la crema aparte.', 12, 'microondas'),
  crema('Crema de champiñones con gambas al ajillo', 'Crema de champiñones', ['100 g Gambas peladas', '1 ud Ajo', '* Aceite de oliva'],
    'Saltea las gambas con ajo. Elige una crema sin nata.', 10, 'fuego'),
  crema('Crema de puerros con atún y tomate', 'Crema de puerros', ['1 ud Atún en lata', '1 ud Tomates'],
    'Atún al natural y tomate en dados al lado. Elige una crema sin nata.', 5, 'microondas'),
  crema('Crema de calabaza con garbanzos crujientes', 'Crema de calabaza', ['80 g Garbanzos cocidos', '* Pimentón', '* Aceite de oliva'],
    'Garbanzos secos tostados en sartén con pimentón; se ponen por encima al servir.', 10, 'fuego'),
  { name: 'Sopa de verduras con pollo y huevo', slot: 'comida', prep_min: 10, equipment: 'microondas', tags: ['ligera', 'crema', 'tupper', 'microondas', 'cuchara'],
    steps: 'Caldo con verdura congelada para sopa 5 min, pollo desmenuzado y huevo cocido.',
    ingredients: ['400 ml Caldo de pollo', '80 g Pollo asado', '1 ud Huevos', '100 g Verdura para sopa congelada'] },

  // Cenas ligeras (sin cremas)
  { name: 'Pisto con huevo', slot: 'cena', prep_min: 8, equipment: 'microondas', tags: ['ligera', 'rapido', 'microondas'],
    steps: 'Pisto en un cuenco, huevo encima pinchando la yema y 2-3 min tapado al microondas.', ingredients: ['200 g Pisto', '1 ud Huevos'] },
  { name: 'Pollo al limón con judías verdes', slot: 'cena', prep_min: 15, equipment: 'fuego', tags: ['ligera'],
    steps: 'Pechuga a la plancha con limón; judías al microondas 6 min tapadas.', ingredients: ['130 g Pechuga de pollo', '150 g Judías verdes', '0,5 ud Limones', '* Aceite de oliva'] },
  { name: 'Salmón en papillote con brócoli', slot: 'cena', prep_min: 8, equipment: 'microondas', tags: ['ligera', 'rapido', 'microondas'],
    steps: 'Salmón sobre brócoli con limón, tapado 5-6 min al microondas.', ingredients: ['125 g Salmón', '150 g Brócoli', '0,25 ud Limones'] },
  { name: 'Revuelto de trigueros y gambas', slot: 'cena', prep_min: 12, equipment: 'fuego', tags: ['ligera', 'rapido'],
    steps: 'Saltea trigueros y gambas, añade huevo y claras batidos.', ingredients: ['1 ud Huevos', '70 ml Claras de huevo', '100 g Espárragos trigueros', '60 g Gambas peladas', '* Aceite de oliva'] },
  { name: 'Calabacín relleno de atún', slot: 'cena', prep_min: 12, equipment: 'microondas', tags: ['ligera', 'microondas'],
    steps: 'Calabacín abierto 5 min al microondas, vacía, mezcla la pulpa con atún y tomate, queso por encima y 2 min más.',
    ingredients: ['1 ud Calabacín', '1 ud Atún en lata', '30 g Tomate triturado', '15 g Queso rallado light'] },
  { name: 'Salteado de pavo con verduras', slot: 'cena', prep_min: 12, equipment: 'fuego', tags: ['ligera', 'rapido'],
    steps: 'Pavo en tiras a fuego fuerte, verduras para wok y un chorrito de soja.', ingredients: ['120 g Pechuga de pavo', '200 g Verduras para wok', '* Salsa de soja', '* Aceite de oliva'] },
  { name: 'Ensalada templada de pollo y manzana', slot: 'cena', prep_min: 10, equipment: 'fuego', tags: ['ligera', 'ensalada'],
    steps: 'Pollo a la plancha en tiras sobre lechuga con manzana y nueces.', ingredients: ['100 g Pechuga de pollo', '0,5 ud Manzanas', '0,25 ud Lechuga', '10 g Nueces', '* Aceite de oliva', '* Vinagre'] },
  { name: 'Bacalao con tomate y pimientos', slot: 'cena', prep_min: 12, equipment: 'microondas', tags: ['ligera', 'microondas'],
    steps: 'Bacalao sobre pimiento en tiras y tomate triturado, tapado 6 min al microondas.', ingredients: ['150 g Bacalao', '100 g Pimientos', '50 g Tomate triturado'] },

  // Tuppers ligeros para la comida
  { name: 'Lentejas con verduras', slot: 'comida', prep_min: 15, equipment: 'fuego', tags: ['ligera', 'tupper', 'microondas', 'cuchara'],
    steps: 'Sofrito de zanahoria, calabacín y pimiento; lentejas cocidas y caldo, 10 min. Sin chorizo.',
    ingredients: ['150 g Lentejas cocidas', '1 ud Zanahoria', '0,5 ud Calabacín', '0,25 ud Pimiento rojo', '* Aceite de oliva', '* Pimentón'] },
  { name: 'Pollo al curry ligero con arroz integral', slot: 'comida', prep_min: 20, equipment: 'fuego', tags: ['ligera', 'tupper', 'microondas'],
    steps: 'Pollo en dados con cebolla y curry; apaga con yogur. Con arroz integral.',
    ingredients: ['120 g Pechuga de pollo', '50 g Arroz integral', '0,5 ud Yogur natural', '0,25 ud Cebolla', '* Curry'] },
  { name: 'Bol de quinoa, pollo y verduras', slot: 'comida', prep_min: 15, equipment: 'fuego', tags: ['ligera', 'tupper', 'ensalada'],
    steps: 'Quinoa cocida y fría con pollo, pepino, tomate y aguacate.',
    ingredients: ['50 g Quinoa', '100 g Pechuga de pollo', '0,5 ud Pepino', '1 ud Tomates', '0,25 ud Aguacate', '* Aceite de oliva'] },
  { name: 'Ensalada de alubias con atún', slot: 'comida', prep_min: 10, equipment: 'ninguno', tags: ['ligera', 'tupper', 'ensalada'],
    steps: 'Alubias escurridas con atún, pimiento y cebolleta. Aliña al comer.',
    ingredients: ['130 g Alubias cocidas', '1 ud Atún en lata', '0,25 ud Pimiento rojo', '0,25 ud Cebolla', '* Aceite de oliva', '* Vinagre'] },
  { name: 'Merluza con patata y brócoli', slot: 'comida', prep_min: 12, equipment: 'microondas', tags: ['ligera', 'tupper', 'microondas'],
    steps: 'Patata en dados y brócoli 6 min tapados al microondas; merluza encima 4 min más.',
    ingredients: ['150 g Merluza', '100 g Patatas', '150 g Brócoli', '* Aceite de oliva'] },
  { name: 'Garbanzos salteados con pavo y espinacas', slot: 'comida', prep_min: 12, equipment: 'fuego', tags: ['ligera', 'tupper', 'microondas'],
    steps: 'Pavo en dados, espinacas y garbanzos con ajo y pimentón.',
    ingredients: ['120 g Garbanzos cocidos', '80 g Pechuga de pavo', '80 g Espinacas', '1 ud Ajo', '* Aceite de oliva', '* Pimentón'] },
]

type Patch = Partial<Pick<Seed, 'slot' | 'ingredients' | 'steps' | 'tags'>>
const tagLight = (name: string) => [name, {}] as const

// Ajustes a las recetas de partida, por nombre original. Todas las que se quedan o se
// aligeran llevan la etiqueta «ligera»; las de «algún día» no cambian.
const ADJUST = new Map<string, Patch>([
  tagLight('Ensalada de garbanzos con atún'),
  tagLight('Ensalada de lentejas'),
  ['Lentejas estofadas', { ingredients: ['150 g Lentejas cocidas', '0,25 ud Cebolla', '1,5 ud Zanahoria', '0,25 ud Pimiento rojo', '* Aceite de oliva', '* Pimentón'] }],
  tagLight('Garbanzos con espinacas'),
  ['Cuscús con verduras y garbanzos', { ingredients: ['50 g Cuscús', '80 g Garbanzos cocidos', '0,5 ud Pepino', '1 ud Tomates', '0,25 ud Pimiento rojo', '* Aceite de oliva'] }],
  tagLight('Patata, judías verdes y huevo'),
  ['Quinoa con verduras asadas', { ingredients: ['70 g Quinoa', '0,5 ud Calabacín', '0,25 ud Pimiento rojo', '60 g Queso fresco batido 0%', '* Aceite de oliva'] }],
  tagLight('Tortilla francesa con ensalada'),
  tagLight('Revuelto de champiñones y espinacas'),
  tagLight('Merluza al microondas con verduras'),
  ['Salmón a la plancha con ensalada', { ingredients: ['125 g Salmón', '0,25 ud Lechuga', '0,5 ud Pepino', '* Aceite de oliva'] }],
  ['Crema de calabacín', { slot: 'comida', ingredients: ['1 ud Calabacín', '0,25 ud Cebolla', '0,5 ud Patatas', '1 ud Huevos', '* Aceite de oliva', '* Sal'],
    steps: 'Calabacín, cebolla y patata cocidos 15 min y triturados, sin quesito. Con un huevo duro al lado. Sale para 2 días.' }],
  ['Gazpacho con huevo duro', { ingredients: ['300 ml Gazpacho', '1 ud Huevos'], steps: 'Gazpacho de brick con huevo duro picado, sin picatostes.' }],
  tagLight('Verduras salteadas con huevo'),
  ['Wrap de pollo y ensalada', { ingredients: ['1 ud Tortillas integrales', '120 g Pechuga de pollo', '0,25 ud Lechuga', '1 ud Tomates', '0,5 ud Yogur natural'] }],
  ['Ensalada de pasta con pollo', { ingredients: ['60 g Pasta integral', '120 g Pechuga de pollo', '200 g Tomate cherry', '50 g Maíz dulce', '* Aceite de oliva'] }],
  ['Arroz con pollo y verduras (tupper)', { ingredients: ['60 g Arroz integral', '120 g Pechuga de pollo', '0,25 ud Pimiento rojo', '1 ud Calabacín', '* Aceite de oliva', '* Sal'] }],
  ['Macarrones con tomate y atún', { ingredients: ['60 g Pasta integral', '100 g Tomate triturado', '1 ud Atún en lata'], steps: 'Cuece la pasta y mezcla con tomate triturado salteado y atún al natural. Sin queso.' }],
  ['Ensalada de arroz', { ingredients: ['60 g Arroz', '1 ud Atún en lata', '50 g Maíz dulce', '1 ud Huevos', '0,25 ud Pimiento rojo', '* Aceite de oliva'] }],
  ['Ensalada César de pollo', { ingredients: ['0,5 ud Lechuga', '120 g Pechuga de pollo', '20 g Queso rallado', '0,5 ud Yogur natural'], steps: 'Lechuga, pollo a la plancha y queso rallado con salsa de yogur. Sin picatostes.' }],
  ['Ensalada de tomate, queso fresco y aguacate', { ingredients: ['2 ud Tomates', '80 g Queso fresco', '0,25 ud Aguacate', '* Aceite de oliva'], steps: 'Corta y aliña. Sin pan.' }],
  ['Sándwich de pavo y queso con ensalada', { ingredients: ['2 ud Pan de molde integral', '50 g Pavo en lonchas', '40 g Queso fresco', '1 ud Tomates'], steps: 'Pan integral con pavo y queso fresco a la plancha. Ensalada de tomate.' }],
  ['Hamburguesa de pollo con ensalada', { ingredients: ['1 ud Hamburguesas de pollo', '0,25 ud Lechuga', '1 ud Tomates', '0,5 ud Calabacín', '* Aceite de oliva'], steps: 'Hamburguesa y calabacín a la plancha, con ensalada de lechuga y tomate.' }],
  ['Ensalada de patata y huevo', { ingredients: ['150 g Patatas', '1 ud Huevos', '1 ud Atún en lata', '0,5 ud Cebolla', '1 ud Tomates', '* Aceite de oliva', '* Vinagre'] }],
  // «Algún día»: siguen activas, con el cambio propuesto pero sin la etiqueta.
  ['Pollo al curry con arroz', { ingredients: ['130 g Pechuga de pollo', '0,25 ud Cebolla', '0,5 ud Yogur natural', '60 g Arroz', '* Curry'], steps: 'Pollo en dados con cebolla y curry; apaga con yogur en vez de nata. Con arroz blanco.', tags: [] }],
  ['Huevos al plato con tomate', { ingredients: ['2 ud Huevos', '80 g Tomate triturado', '50 g Guisantes congelados'], tags: [] }],
  ['Pizza casera en tortilla de trigo', { ingredients: ['1 ud Tortillas de trigo', '40 g Tomate triturado', '50 g Mozzarella light', '50 g Jamón york', '50 g Champiñones'], steps: 'Tortilla de trigo con tomate, mozzarella light, jamón york y champiñones. 8 min de horno.', tags: [] }],
])

const parse = (lines: string[]) => lines.map(parseIngredient).filter((x): x is Ingredient => !!x)
const sameIngredients = (a: Ingredient[], b: Ingredient[]) => a.map(ingredientLabel).join('\n') === b.map(ingredientLabel).join('\n')

export interface LightPack {
  add: Recipe[]
  adjust: { id: string; name: string; patch: Partial<Recipe> }[]
  /** Recetas de partida que no tocamos porque las habéis editado. */
  skipped: string[]
}

/**
 * Qué falta por aplicar: recetas nuevas que no existen (por nombre) y ajustes a las
 * recetas de partida que siguen tal cual se crearon. Lo editado a mano no se toca.
 */
export function lightPack(recipes: Recipe[], householdId: string, idFor: (i: number) => string): LightPack {
  const byName = new Map(recipes.map((r) => [norm(r.name), r]))
  const add = LIGHT_RECIPES.flatMap((s, i) => (byName.has(norm(s.name)) ? [] : [{
    ...s, id: idFor(i), household_id: householdId, active: true, ingredients: parse(s.ingredients),
  } as Recipe]))
  const adjust: LightPack['adjust'] = []
  const skipped: string[] = []
  for (const [name, p] of ADJUST) {
    const r = byName.get(norm(name))
    const seed = SEED_RECIPES.find((s) => s.name === name)
    if (!r || !seed) continue
    const tags = p.tags ?? [...new Set([...seed.tags, 'ligera'])]
    const target: Partial<Recipe> = {
      slot: p.slot ?? seed.slot,
      tags,
      steps: p.steps ?? seed.steps ?? null,
      ingredients: parse(p.ingredients ?? seed.ingredients),
    }
    const alreadyDone = r.slot === target.slot && (r.steps ?? null) === target.steps && sameIngredients(r.ingredients, target.ingredients!)
      && r.tags.join() === tags.join()
    if (alreadyDone) continue
    const untouched = r.slot === seed.slot && (r.steps ?? null) === (seed.steps ?? null) && sameIngredients(r.ingredients, parse(seed.ingredients))
      && r.tags.join() === seed.tags.join()
    if (!untouched) { skipped.push(r.name); continue }
    adjust.push({ id: r.id, name: r.name, patch: target })
  }
  return { add, adjust, skipped }
}
