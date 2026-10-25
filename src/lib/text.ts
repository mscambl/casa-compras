/** Normaliza para comparar nombres: minúsculas, sin tildes, espacios simples. Igual que public.norm() en SQL. */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Primera letra en mayúscula, resto como lo escribió el usuario. */
export function cap(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Busca productos por coincidencia de palabras; prioriza los que empiezan igual. */
export function rank<T extends { name: string }>(items: T[], q: string, limit = 8): T[] {
  const nq = norm(q)
  if (!nq) return []
  const words = nq.split(' ')
  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const n = norm(item.name)
    if (!words.every((w) => n.includes(w))) continue
    let score = 0
    if (n === nq) score += 100
    if (n.startsWith(nq)) score += 50
    if (n.split(' ').some((w) => w.startsWith(words[0]))) score += 20
    score -= n.length / 100
    scored.push({ item, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item)
}

// Palabras clave (inicio de palabra) -> categoría sugerida. Se puede cambiar después.
const CATEGORY_HINTS: [string, string[]][] = [
  ['Papel', ['papel higienico', 'papel de cocina', 'servilleta', 'panuelo', 'rollo', 'papel']],
  ['Fruta y verdura', ['manzana', 'platano', 'naranja', 'pera', 'uva', 'fresa', 'limon', 'lechuga', 'tomate', 'cebolla', 'ajo', 'patata', 'zanahoria', 'pimiento', 'pepino', 'calabacin', 'berenjena', 'espinaca', 'brocoli', 'aguacate', 'fruta', 'verdura', 'ensalada', 'rucula', 'canonigo', 'champinon', 'kiwi', 'melon', 'sandia', 'mandarina', 'puerro', 'judia verde']],
  ['Carne y pescado', ['pollo', 'pavo', 'ternera', 'cerdo', 'lomo', 'carne', 'hamburguesa', 'salchicha', 'chorizo', 'jamon', 'pescado', 'merluza', 'salmon', 'atun fresco', 'gamba', 'bacalao', 'sardina', 'lubina', 'dorada', 'filete', 'pechuga', 'muslo', 'fiambre', 'embutido']],
  ['Lácteos y huevos', ['leche', 'yogur', 'queso', 'mantequilla', 'nata', 'huevo', 'kefir', 'cuajada', 'bebida de avena', 'bebida de soja']],
  ['Panadería', ['pan', 'barra', 'baguette', 'tostada', 'biscote', 'bolleria', 'croissant', 'magdalena', 'tortilla de trigo', 'wrap']],
  ['Congelados', ['congelad', 'helado', 'pizza', 'guisante']],
  ['Platos preparados', ['preparad', 'gazpacho', 'salmorejo', 'hummus', 'tortilla de patata', 'lasana', 'croqueta']],
  ['Bebidas', ['agua', 'cerveza', 'vino', 'refresco', 'zumo', 'cafe', 'te ', 'infusion', 'coca']],
  ['Despensa', ['arroz', 'pasta', 'macarron', 'espagueti', 'harina', 'azucar', 'sal', 'aceite', 'vinagre', 'legumbre', 'garbanzo', 'lenteja', 'alubia', 'atun', 'conserva', 'tomate frito', 'cereal', 'avena', 'galleta', 'chocolate', 'especia', 'caldo', 'mayonesa', 'ketchup', 'mostaza', 'frutos secos', 'nuez', 'almendra', 'miel', 'mermelada', 'cacao', 'quinoa', 'cuscus']],
  ['Limpieza', ['lejia', 'friegasuelo', 'lavavajillas', 'fregona', 'bayeta', 'estropajo', 'limpiador', 'multiusos', 'bolsa de basura', 'bolsas basura', 'amoniaco', 'limpiacristales', 'ambientador', 'pastilla lavavajillas']],
  ['Higiene personal', ['champu', 'gel', 'jabon', 'pasta de dientes', 'dentifrico', 'cepillo', 'desodorante', 'compresa', 'tampon', 'cuchilla', 'crema', 'colutorio', 'algodon', 'bastoncillo', 'hilo dental', 'toallita']],
  ['Lavandería', ['detergente', 'suavizante', 'quitamanchas', 'lavadora', 'percarbonato']],
]

export function guessCategoryName(name: string): string | null {
  const n = ` ${norm(name)} `
  // Gana la palabra clave más larga: "pasta de dientes" antes que "pasta".
  let best: string | null = null
  let bestLen = 0
  for (const [cat, words] of CATEGORY_HINTS) {
    for (const w of words) {
      if (w.length > bestLen && n.includes(' ' + w)) {
        best = cat
        bestLen = w.length
      }
    }
  }
  return best
}
