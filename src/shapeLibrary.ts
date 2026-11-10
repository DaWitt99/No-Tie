export type ShapePath = { d: string; fill?: 'none' }
export type ShapeDefinition = { id: string; label: string; category: 'Schemat blokowy' | 'Elektryczne' | 'Rysunek techniczny'; paths: ShapePath[] }

const outline = (d: string): ShapePath => ({ d })
const stroke = (d: string): ShapePath => ({ d, fill: 'none' })

function gearPath(teeth = 12): string {
  const points = Array.from({ length: teeth * 4 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / (teeth * 4)
    const radius = index % 4 === 0 || index % 4 === 3 ? 46 : 34
    return `${Number((50 + Math.cos(angle) * radius).toFixed(2))} ${Number((50 + Math.sin(angle) * radius).toFixed(2))}`
  })
  return `M ${points.join(' L ')} Z M 50 36 A 14 14 0 1 0 50 64 A 14 14 0 1 0 50 36 Z`
}

export const shapeLibrary: ShapeDefinition[] = [
  { id: 'flow-process', label: 'Proces', category: 'Schemat blokowy', paths: [outline('M 10 14 H 90 V 86 H 10 Z')] },
  { id: 'flow-decision', label: 'Decyzja', category: 'Schemat blokowy', paths: [outline('M 50 6 L 94 50 L 50 94 L 6 50 Z')] },
  { id: 'flow-io', label: 'Wejście / wyjście', category: 'Schemat blokowy', paths: [outline('M 23 14 H 94 L 77 86 H 6 Z')] },
  { id: 'flow-predefined', label: 'Podproces', category: 'Schemat blokowy', paths: [outline('M 10 14 H 90 V 86 H 10 Z'), stroke('M 25 14 V 86 M 75 14 V 86')] },
  { id: 'flow-terminator', label: 'Start / koniec', category: 'Schemat blokowy', paths: [outline('M 34 12 H 66 C 84 12 92 27 92 50 C 92 73 84 88 66 88 H 34 C 16 88 8 73 8 50 C 8 27 16 12 34 12 Z')] },
  { id: 'flow-preparation', label: 'Przygotowanie', category: 'Schemat blokowy', paths: [outline('M 25 12 H 75 L 94 50 L 75 88 H 25 L 6 50 Z')] },
  { id: 'flow-manual-input', label: 'Ręczne wejście', category: 'Schemat blokowy', paths: [outline('M 8 29 L 92 10 V 88 H 8 Z')] },
  { id: 'flow-manual-operation', label: 'Operacja ręczna', category: 'Schemat blokowy', paths: [outline('M 10 12 H 90 L 76 88 H 24 Z')] },
  { id: 'flow-document', label: 'Dokument', category: 'Schemat blokowy', paths: [outline('M 12 10 H 88 V 75 Q 68 92 50 78 Q 30 65 12 84 Z')] },
  { id: 'flow-documents', label: 'Wiele dokumentów', category: 'Schemat blokowy', paths: [outline('M 23 12 H 84 V 22 L 92 30 V 82 H 23 Z'), stroke('M 14 21 V 89 H 82 M 14 21 H 75 L 84 30')] },
  { id: 'flow-database', label: 'Baza danych', category: 'Schemat blokowy', paths: [outline('M 10 20 C 10 5 90 5 90 20 V 80 C 90 95 10 95 10 80 Z'), stroke('M 10 20 C 10 35 90 35 90 20 M 10 50 C 10 65 90 65 90 50')] },
  { id: 'flow-storage', label: 'Pamięć wewnętrzna', category: 'Schemat blokowy', paths: [outline('M 10 14 H 90 V 86 H 10 Z'), stroke('M 25 14 V 86 M 10 28 H 90')] },
  { id: 'flow-display', label: 'Ekran', category: 'Schemat blokowy', paths: [outline('M 10 14 H 68 C 85 14 92 28 92 50 C 92 72 85 86 68 86 H 10 Z')] },
  { id: 'flow-delay', label: 'Opóźnienie', category: 'Schemat blokowy', paths: [outline('M 8 14 H 50 A 42 36 0 0 1 50 86 H 8 Z')] },
  { id: 'flow-merge', label: 'Scalanie', category: 'Schemat blokowy', paths: [outline('M 8 18 H 92 L 50 84 Z')] },
  { id: 'flow-extract', label: 'Wyodrębnienie', category: 'Schemat blokowy', paths: [outline('M 8 82 H 92 L 50 16 Z')] },
  { id: 'flow-sum', label: 'Sumator', category: 'Schemat blokowy', paths: [outline('M 50 8 A 42 42 0 1 0 50 92 A 42 42 0 1 0 50 8 Z'), stroke('M 50 25 V 75 M 25 50 H 75')] },
  { id: 'flow-connector', label: 'Łącznik', category: 'Schemat blokowy', paths: [outline('M 50 8 A 42 42 0 1 0 50 92 A 42 42 0 1 0 50 8 Z')] },
  { id: 'flow-off-page', label: 'Łącznik poza stroną', category: 'Schemat blokowy', paths: [outline('M 12 12 H 88 V 62 L 50 90 L 12 62 Z')] },
  { id: 'flow-annotation', label: 'Adnotacja', category: 'Schemat blokowy', paths: [outline('M 14 14 H 86 V 72 H 51 L 33 90 V 72 H 14 Z'), stroke('M 28 34 H 72 M 28 51 H 64')] },

  { id: 'tech-resistor-zigzag', label: 'Rezystor (IEC)', category: 'Elektryczne', paths: [stroke('M 0 50 H 18 L 25 28 L 35 72 L 45 28 L 55 72 L 65 28 L 75 72 L 82 50 H 100')] },
  { id: 'tech-resistor-box', label: 'Rezystor prostokątny', category: 'Elektryczne', paths: [stroke('M 0 50 H 24 M 76 50 H 100 M 24 32 H 76 V 68 H 24 Z')] },
  { id: 'tech-capacitor', label: 'Kondensator', category: 'Elektryczne', paths: [stroke('M 0 50 H 43 M 43 24 V 76 M 57 24 V 76 M 57 50 H 100')] },
  { id: 'tech-inductor', label: 'Cewka', category: 'Elektryczne', paths: [stroke('M 0 50 H 16 M 84 50 H 100 M 16 50 A 8 15 0 0 1 32 50 A 8 15 0 0 1 48 50 A 8 15 0 0 1 64 50 A 8 15 0 0 1 84 50')] },
  { id: 'tech-diode', label: 'Dioda', category: 'Elektryczne', paths: [stroke('M 0 50 H 28 M 72 50 H 100 M 30 25 V 75 M 30 25 L 68 50 L 30 75 Z')] },
  { id: 'tech-led', label: 'Dioda LED', category: 'Elektryczne', paths: [stroke('M 0 56 H 28 M 72 56 H 100 M 30 31 V 81 M 30 31 L 68 56 L 30 81 Z M 55 25 L 78 6 M 69 22 L 78 6 L 62 11')] },
  { id: 'tech-transistor', label: 'Tranzystor NPN', category: 'Elektryczne', paths: [stroke('M 8 50 H 38 M 38 19 V 81 M 38 34 L 82 10 M 38 66 L 82 90 M 68 72 L 82 90 L 58 88')] },
  { id: 'tech-ground', label: 'Masa', category: 'Elektryczne', paths: [stroke('M 50 8 V 42 M 25 42 H 75 M 32 56 H 68 M 40 70 H 60 M 46 84 H 54')] },
  { id: 'tech-battery', label: 'Bateria', category: 'Elektryczne', paths: [stroke('M 0 50 H 30 M 30 25 V 75 M 42 37 V 63 M 42 50 H 60 M 60 18 V 82 M 73 32 V 68 M 73 50 H 100')] },
  { id: 'tech-switch', label: 'Wyłącznik', category: 'Elektryczne', paths: [stroke('M 0 65 H 25 M 75 65 H 100 M 25 65 L 68 31'), outline('M 18 58 A 7 7 0 1 0 18 72 A 7 7 0 1 0 18 58 Z M 82 58 A 7 7 0 1 0 82 72 A 7 7 0 1 0 82 58 Z')] },

  { id: 'tech-gear', label: 'Koło zębate', category: 'Rysunek techniczny', paths: [outline(gearPath())] },
  { id: 'tech-bolt', label: 'Śruba', category: 'Rysunek techniczny', paths: [outline('M 25 12 H 75 L 88 25 V 42 H 25 Z'), stroke('M 45 42 V 90 M 45 51 H 72 M 45 62 H 72 M 45 73 H 72 M 45 84 H 72')] },
  { id: 'tech-nut', label: 'Nakrętka sześciokątna', category: 'Rysunek techniczny', paths: [outline('M 50 8 L 88 29 V 71 L 50 92 L 12 71 V 29 Z'), stroke('M 50 31 L 68 41 V 60 L 50 70 L 32 60 V 41 Z')] },
  { id: 'tech-spring', label: 'Sprężyna', category: 'Rysunek techniczny', paths: [stroke('M 0 50 H 12 L 23 24 L 37 76 L 51 24 L 65 76 L 79 24 L 89 50 H 100')] },
  { id: 'tech-bearing', label: 'Łożysko', category: 'Rysunek techniczny', paths: [outline('M 15 15 H 85 V 85 H 15 Z'), stroke('M 28 28 H 72 V 72 H 28 Z M 50 14 V 28 M 50 72 V 86')] },
  { id: 'tech-shaft', label: 'Wał stopniowany', category: 'Rysunek techniczny', paths: [outline('M 8 35 H 26 V 22 H 74 V 35 H 92 V 65 H 74 V 78 H 26 V 65 H 8 Z')] },
  { id: 'tech-elbow', label: 'Kolano rurowe', category: 'Rysunek techniczny', paths: [stroke('M 15 12 V 52 Q 15 85 48 85 H 86 M 38 12 V 52 Q 38 62 48 62 H 86 M 15 12 H 38 M 86 62 V 85')] },
  { id: 'tech-flange', label: 'Kołnierz rurowy', category: 'Rysunek techniczny', paths: [stroke('M 0 38 H 100 M 0 62 H 100 M 25 20 V 80 M 75 20 V 80 M 25 20 H 75 M 25 80 H 75'), outline('M 33 38 A 17 12 0 1 0 67 38 A 17 12 0 1 0 33 38 Z')] },
  { id: 'tech-centerline', label: 'Osie / środek', category: 'Rysunek techniczny', paths: [stroke('M 50 5 V 35 M 50 65 V 95 M 5 50 H 35 M 65 50 H 95 M 36 36 L 64 64 M 64 36 L 36 64')] },
  { id: 'tech-dimension', label: 'Linia wymiarowa', category: 'Rysunek techniczny', paths: [stroke('M 18 22 V 78 M 82 22 V 78 M 18 50 H 82'), outline('M 8 50 L 22 43 V 57 Z M 92 50 L 78 43 V 57 Z')] },
]

export const shapeById = (id: string) => shapeLibrary.find(shape => shape.id === id) ?? shapeLibrary[0]

export const shapeCategories = ['Schemat blokowy', 'Elektryczne', 'Rysunek techniczny'] as const
