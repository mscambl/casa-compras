import type { Ingredient, Recipe } from './types'

export type Seed = Omit<Recipe, 'id' | 'household_id' | 'active' | 'ingredients'> & { ingredients: string[] }

// "150 g Pechuga de pollo" | "2 ud Huevos" | "* Aceite de oliva" (básico de despensa)
export function parseIngredient(line: string): Ingredient | null {
  const t = line.trim()
  if (!t) return null
  if (t.startsWith('*')) return { name: t.slice(1).trim(), amount: 0, unit: 'ud', basic: true }
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|ud|uds?|unidades?)?\s+(.+)$/i)
  if (!m) return { name: t, amount: 1, unit: 'ud', basic: false }
  let unit = (m[2] || 'ud').toLowerCase()
  if (unit.startsWith('u')) unit = 'ud'
  return { name: m[3].trim(), amount: Number(m[1].replace(',', '.')), unit: unit as Ingredient['unit'], basic: false }
}

export function ingredientLabel(i: Ingredient): string {
  if (i.basic) return `* ${i.name}`
  return `${String(i.amount).replace('.', ',')} ${i.unit} ${i.name}`
}

// Recetario inicial: platos baratos, poca preparación, muchas ensaladas y tuppers de microondas.
// Cantidades por ración. Se puede editar todo desde la app.
export const SEED_RECIPES: Seed[] = [
  // Comidas para llevar
  { name: 'Ensalada de garbanzos con atún', slot: 'ambas', prep_min: 10, equipment: 'ninguno', tags: ['ensalada', 'tupper'], steps: 'Escurre los garbanzos, mezcla con atún, tomate, cebolla y pimiento picados. Aliña al comer.',
    ingredients: ['130 g Garbanzos cocidos', '1 ud Atún en lata', '1 ud Tomates', '0,25 ud Cebolla', '0,25 ud Pimiento rojo', '* Aceite de oliva', '* Vinagre'] },
  { name: 'Ensalada de lentejas', slot: 'comida', prep_min: 10, equipment: 'ninguno', tags: ['ensalada', 'tupper'], steps: 'Lentejas cocidas escurridas con tomate, pepino, cebolla y huevo duro.',
    ingredients: ['130 g Lentejas cocidas', '1 ud Tomates', '0,5 ud Pepino', '0,25 ud Cebolla', '1 ud Huevos', '* Aceite de oliva', '* Vinagre'] },
  { name: 'Ensalada de pasta con pollo', slot: 'comida', prep_min: 20, equipment: 'fuego', tags: ['ensalada', 'tupper'], steps: 'Cuece la pasta, enfría. Mezcla con pollo a la plancha en tiras, tomate cherry y maíz.',
    ingredients: ['80 g Pasta', '120 g Pechuga de pollo', '100 g Tomate cherry', '50 g Maíz dulce', '* Aceite de oliva'] },
  { name: 'Arroz con pollo y verduras (tupper)', slot: 'comida', prep_min: 25, equipment: 'fuego', tags: ['tupper', 'microondas'], steps: 'Sofríe pollo en dados con pimiento y calabacín, añade el arroz cocido. Calienta 2 min al microondas.',
    ingredients: ['80 g Arroz', '120 g Pechuga de pollo', '0,25 ud Pimiento rojo', '0,5 ud Calabacín', '* Aceite de oliva', '* Sal'] },
  { name: 'Lentejas estofadas', slot: 'comida', prep_min: 15, equipment: 'fuego', tags: ['tupper', 'microondas', 'cuchara'], steps: 'Sofrito de cebolla, zanahoria y pimiento; añade lentejas cocidas y caldo, 10 min. Aguanta 3 días en nevera.',
    ingredients: ['150 g Lentejas cocidas', '0,25 ud Cebolla', '1 ud Zanahoria', '0,25 ud Pimiento rojo', '0,5 ud Patatas', '* Aceite de oliva', '* Pimentón'] },
  { name: 'Garbanzos con espinacas', slot: 'comida', prep_min: 15, equipment: 'fuego', tags: ['tupper', 'microondas', 'cuchara'], steps: 'Ajo y pimentón, espinacas, garbanzos y un chorro de agua. 8 min.',
    ingredients: ['150 g Garbanzos cocidos', '100 g Espinacas', '1 ud Ajo', '* Aceite de oliva', '* Pimentón'] },
  { name: 'Macarrones con tomate y atún', slot: 'comida', prep_min: 15, equipment: 'fuego', tags: ['tupper', 'microondas'], steps: 'Cuece la pasta y mezcla con tomate frito y atún.',
    ingredients: ['90 g Pasta', '100 g Tomate frito', '1 ud Atún en lata', '20 g Queso rallado'] },
  { name: 'Cuscús con verduras y garbanzos', slot: 'comida', prep_min: 10, equipment: 'microondas', tags: ['tupper', 'microondas', 'ensalada'], steps: 'Hidrata el cuscús con agua caliente 5 min. Mezcla con garbanzos, pepino, tomate y pimiento.',
    ingredients: ['70 g Cuscús', '80 g Garbanzos cocidos', '0,5 ud Pepino', '1 ud Tomates', '0,25 ud Pimiento rojo', '* Aceite de oliva'] },
  { name: 'Ensalada de arroz', slot: 'comida', prep_min: 20, equipment: 'fuego', tags: ['ensalada', 'tupper'], steps: 'Arroz cocido y frío con atún, maíz, huevo duro y pimiento.',
    ingredients: ['80 g Arroz', '1 ud Atún en lata', '50 g Maíz dulce', '1 ud Huevos', '0,25 ud Pimiento rojo', '* Aceite de oliva'] },
  { name: 'Patata, judías verdes y huevo', slot: 'comida', prep_min: 12, equipment: 'microondas', tags: ['tupper', 'microondas'], steps: 'Patata en dados y judías al microondas 8 min tapadas con un poco de agua. Huevo cocido.',
    ingredients: ['1 ud Patatas', '150 g Judías verdes', '1 ud Huevos', '* Aceite de oliva', '* Sal'] },
  { name: 'Wrap de pollo y ensalada', slot: 'ambas', prep_min: 10, equipment: 'fuego', tags: ['rapido'], steps: 'Pollo a la plancha en tiras con lechuga, tomate y salsa de yogur.',
    ingredients: ['2 ud Tortillas de trigo', '120 g Pechuga de pollo', '0,25 ud Lechuga', '1 ud Tomates', '0,5 ud Yogur natural'] },
  { name: 'Quinoa con verduras asadas', slot: 'comida', prep_min: 20, equipment: 'microondas', tags: ['tupper', 'ensalada'], steps: 'Quinoa cocida con calabacín y pimiento hechos al microondas 6 min, y queso fresco.',
    ingredients: ['70 g Quinoa', '0,5 ud Calabacín', '0,25 ud Pimiento rojo', '60 g Queso fresco', '* Aceite de oliva'] },

  // Cenas
  { name: 'Tortilla francesa con ensalada', slot: 'cena', prep_min: 10, equipment: 'fuego', tags: ['rapido', 'ensalada'], steps: 'Tortilla de 2 huevos y ensalada de lechuga y tomate.',
    ingredients: ['2 ud Huevos', '0,25 ud Lechuga', '1 ud Tomates', '* Aceite de oliva', '* Sal'] },
  { name: 'Ensalada César de pollo', slot: 'cena', prep_min: 15, equipment: 'fuego', tags: ['ensalada'], steps: 'Lechuga, pollo a la plancha, picatostes y queso rallado con salsa de yogur.',
    ingredients: ['0,5 ud Lechuga', '120 g Pechuga de pollo', '20 g Queso rallado', '0,5 ud Yogur natural', '30 g Pan'] },
  { name: 'Revuelto de champiñones y espinacas', slot: 'cena', prep_min: 10, equipment: 'fuego', tags: ['rapido'], steps: 'Saltea champiñones y espinacas con ajo, añade los huevos batidos.',
    ingredients: ['2 ud Huevos', '100 g Champiñones', '60 g Espinacas', '1 ud Ajo', '* Aceite de oliva'] },
  { name: 'Merluza al microondas con verduras', slot: 'cena', prep_min: 12, equipment: 'microondas', tags: ['rapido', 'microondas'], steps: 'Merluza sobre calabacín y cebolla en láminas, tapada, 5-6 min al microondas.',
    ingredients: ['150 g Merluza', '0,5 ud Calabacín', '0,25 ud Cebolla', '* Aceite de oliva', '* Sal'] },
  { name: 'Salmón a la plancha con ensalada', slot: 'cena', prep_min: 12, equipment: 'fuego', tags: ['ensalada'], steps: 'Salmón a la plancha 4 min por lado y ensalada verde.',
    ingredients: ['150 g Salmón', '0,25 ud Lechuga', '0,5 ud Pepino', '* Aceite de oliva'] },
  { name: 'Ensalada de tomate, queso fresco y aguacate', slot: 'cena', prep_min: 8, equipment: 'ninguno', tags: ['ensalada', 'rapido'], steps: 'Corta y aliña. Con pan.',
    ingredients: ['2 ud Tomates', '80 g Queso fresco', '0,5 ud Aguacate', '30 g Pan', '* Aceite de oliva'] },
  { name: 'Pizza casera en tortilla de trigo', slot: 'cena', prep_min: 15, equipment: 'horno', tags: ['rapido'], steps: 'Tortilla de trigo con tomate frito, mozzarella y jamón york. 8 min de horno.',
    ingredients: ['1 ud Tortillas de trigo', '40 g Tomate frito', '60 g Mozzarella', '50 g Jamón york'] },
  { name: 'Crema de calabacín', slot: 'cena', prep_min: 25, equipment: 'fuego', tags: ['cuchara'], steps: 'Calabacín, cebolla y patata cocidos 15 min y triturados con quesito. Sale para 2 noches.',
    ingredients: ['1 ud Calabacín', '0,25 ud Cebolla', '0,5 ud Patatas', '1 ud Quesitos', '* Aceite de oliva', '* Sal'] },
  { name: 'Huevos al plato con tomate', slot: 'cena', prep_min: 15, equipment: 'horno', tags: [], steps: 'Tomate frito en cazuelita, huevos encima y guisantes. 10 min de horno o 3 al microondas pinchando la yema.',
    ingredients: ['2 ud Huevos', '80 g Tomate frito', '50 g Guisantes congelados'] },
  { name: 'Pollo al curry con arroz', slot: 'cena', prep_min: 25, equipment: 'fuego', tags: [], steps: 'Pollo en dados con cebolla, curry y nata ligera. Con arroz blanco.',
    ingredients: ['130 g Pechuga de pollo', '0,25 ud Cebolla', '50 ml Nata para cocinar', '60 g Arroz', '* Curry'] },
  { name: 'Sándwich de pavo y queso con ensalada', slot: 'cena', prep_min: 8, equipment: 'fuego', tags: ['rapido'], steps: 'Pan de molde, pavo y queso a la plancha. Ensalada de tomate.',
    ingredients: ['2 ud Pan de molde', '50 g Pavo en lonchas', '30 g Queso en lonchas', '1 ud Tomates'] },
  { name: 'Gazpacho con huevo duro', slot: 'cena', prep_min: 5, equipment: 'ninguno', tags: ['rapido'], steps: 'Gazpacho de brick con huevo duro picado y picatostes.',
    ingredients: ['300 ml Gazpacho', '1 ud Huevos', '20 g Pan'] },
  { name: 'Hamburguesa de pollo con ensalada', slot: 'cena', prep_min: 12, equipment: 'fuego', tags: ['rapido'], steps: 'Hamburguesa a la plancha y ensalada de lechuga y tomate.',
    ingredients: ['1 ud Hamburguesas de pollo', '0,25 ud Lechuga', '1 ud Tomates', '* Aceite de oliva'] },
  { name: 'Verduras salteadas con huevo', slot: 'cena', prep_min: 15, equipment: 'fuego', tags: [], steps: 'Saltea calabacín, pimiento y champiñones; termina con un huevo encima.',
    ingredients: ['0,5 ud Calabacín', '0,25 ud Pimiento rojo', '80 g Champiñones', '1 ud Huevos', '* Aceite de oliva'] },
  { name: 'Ensalada de patata y huevo', slot: 'ambas', prep_min: 12, equipment: 'microondas', tags: ['ensalada', 'tupper', 'microondas'], steps: 'Patata en dados al microondas 7 min, huevo duro, atún y cebolleta.',
    ingredients: ['1 ud Patatas', '1 ud Huevos', '1 ud Atún en lata', '0,25 ud Cebolla', '* Aceite de oliva', '* Vinagre'] },
]

export function seedRecipes(householdId: string, uid: () => string): Recipe[] {
  return SEED_RECIPES.map((r) => ({
    ...r,
    id: uid(),
    household_id: householdId,
    active: true,
    ingredients: r.ingredients.map(parseIngredient).filter((x): x is Ingredient => !!x),
  }))
}
