import { expect, test, type Page } from '@playwright/test'

async function openTool(page: Page, label: string) {
  const mobileMenu = page.getByRole('button', { name: 'Otwórz menu folderów i narzędzi' })
  if (await mobileMenu.isVisible().catch(() => false)) await mobileMenu.click()
  await page.locator('.sidebar .nav-item').filter({ hasText: label }).first().click()
}

async function openAllNotes(page: Page) {
  await openTool(page, 'Wszystkie notatki')
  await expect(page.getByRole('heading', { name: 'Wszystkie notatki' })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByLabel('Tytuł notatki')).toBeVisible()
  await expect(page.getByLabel('Tytuł notatki')).toHaveValue('Witaj w No-Tie')
})

test.describe('Biblioteka notatek', () => {
  test('uruchamia się z przykładowymi notatkami i zapisem lokalnym', async ({ page }) => {
    await expect(page.locator('.notes-panel')).toContainText('Przygotowanie spotkania')
    await expect(page.locator('.notes-panel')).toContainText('Rzeczy do sprawdzenia')
    await expect(page.locator('.notes-list-footer')).toContainText('Zapis na tym urządzeniu')
  })

  test('wyszukuje notatkę w osobnym widoku biblioteki', async ({ page }) => {
    await openAllNotes(page)
    await page.getByRole('textbox', { name: 'Szukaj w notatkach' }).fill('spotkania')
    await expect(page.locator('.all-notes-card')).toHaveCount(1)
    await expect(page.locator('.all-notes-card')).toContainText('Przygotowanie spotkania')
  })

  test('filtruje notatki po tagu i folderze', async ({ page }) => {
    await openAllNotes(page)
    await page.getByLabel('Tag').selectOption({ label: 'projekt' })
    await expect(page.locator('.all-notes-card')).toHaveCount(1)
    await expect(page.locator('.all-notes-card')).toContainText('Przygotowanie spotkania')
    await page.getByLabel('Tag').selectOption('')
    await page.locator('.all-notes-filter-controls .all-notes-select').nth(1).locator('select').selectOption({ label: 'Praca' })
    await expect(page.locator('.all-notes-card')).toHaveCount(1)
    await expect(page.locator('.all-notes-card')).toContainText('Przygotowanie spotkania')
  })

  test('sortuje bibliotekę po tytule rosnąco i malejąco', async ({ page }) => {
    await openAllNotes(page)
    const sort = page.getByLabel('Sortuj')
    await sort.selectOption('title-asc')
    await expect(page.locator('.all-notes-card-title').first()).toHaveText('Przygotowanie spotkania')
    await sort.selectOption('title-desc')
    await expect(page.locator('.all-notes-card-title').first()).toHaveText('Witaj w No-Tie')
  })

  test('filtr „Tylko ulubione” pokazuje i przywraca właściwy zbiór', async ({ page }) => {
    await openAllNotes(page)
    await page.getByLabel('Tylko ulubione').check()
    await expect(page.locator('.all-notes-card')).toHaveCount(1)
    await expect(page.locator('.all-notes-card')).toContainText('Witaj w No-Tie')
    await page.getByRole('button', { name: 'Wyczyść filtry' }).click()
    await expect(page.locator('.all-notes-card')).toHaveCount(3)
  })

  test('tworzy notatkę z pustego szablonu i zachowuje zmianę tytułu po odświeżeniu', async ({ page }) => {
    await page.getByRole('button', { name: 'Nowa notatka' }).click()
    await expect(page.locator('.create-note-page-heading').getByRole('heading', { name: 'Nowa notatka' })).toBeVisible()
    await page.getByRole('button', { name: 'Utwórz notatkę' }).click()
    const title = page.getByLabel('Tytuł notatki')
    await expect(title).toBeVisible()
    await title.fill('Test automatyczny — notatka')
    await expect(page.locator('.save-indicator')).toContainText('Zapisano', { timeout: 5_000 })
    await page.reload()
    await expect(page.getByLabel('Tytuł notatki')).toHaveValue('Test automatyczny — notatka')
  })

  test('podgląd tworzonej notatki przełącza się między widokiem podstawowym i Markdown', async ({ page }) => {
    await page.getByRole('button', { name: 'Nowa notatka' }).click()
    await page.locator('.create-note-settings-card select').nth(1).selectOption('meeting')
    await expect(page.locator('.create-note-preview-content')).toContainText('Cel spotkania')
    await page.getByRole('button', { name: 'Widok Markdown' }).click()
    await expect(page.locator('.create-note-preview-content pre')).toContainText('## Agenda')
    await page.getByRole('button', { name: 'Widok podstawowy' }).click()
    await expect(page.locator('.create-note-preview-content')).toContainText('Agenda')
  })

  test('dodaje tag do notatki klawiszem Enter i zapisuje go w wyszukiwarce', async ({ page }) => {
    await page.getByLabel('Dodaj tag').fill('e2e-tag')
    await page.getByLabel('Dodaj tag').press('Enter')
    await expect(page.locator('.tag-list')).toContainText('e2e-tag')
    await openAllNotes(page)
    await page.getByLabel('Tag').selectOption('e2e-tag')
    await expect(page.locator('.all-notes-card')).toHaveCount(1)
    await expect(page.locator('.all-notes-card')).toContainText('Witaj w No-Tie')
  })

  test('zmienia edytor do surowego Markdown i wraca do widoku wizualnego', async ({ page }) => {
    await page.getByRole('button', { name: 'Surowy Markdown' }).click()
    await expect(page.getByRole('button', { name: 'Surowy Markdown' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.markdown-source-editor')).toBeVisible()
    await page.getByRole('button', { name: 'Widok wizualny' }).click()
    await expect(page.getByRole('button', { name: 'Widok wizualny' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('otwiera i zamyka nową notatkę bez dodawania jej do biblioteki', async ({ page }) => {
    await page.getByRole('button', { name: 'Nowa notatka' }).click()
    await page.getByRole('button', { name: 'Anuluj' }).click()
    await expect(page.locator('.create-note-page')).toHaveCount(0)
    await expect(page.locator('.notes-panel')).not.toContainText('Nowa notatka')
  })

  test('widok siatki można włączyć i zamknąć', async ({ page }) => {
    await page.getByRole('button', { name: 'Siatka notatek' }).click()
    await expect(page.locator('.note-grid-view')).toBeVisible()
    await page.getByRole('button', { name: 'Pojedynczy widok' }).click()
    await expect(page.locator('.note-grid-view')).toHaveCount(0)
  })
})

test.describe('Widoki aplikacji', () => {
  const tools = [
    { label: 'Zadania', heading: 'Zadania' },
    { label: 'Fiszki', heading: 'Fiszki' },
    { label: 'Kolekcje', heading: 'Kolekcje' },
    { label: 'Kontrola powiązań', heading: 'Kontrola powiązań' },
    { label: 'Załączniki', heading: 'Załączniki' },
    { label: 'Statusy notatek', heading: 'Statusy notatek' },
    { label: 'Pulpit projektów', heading: 'Pulpit projektów' },
    { label: 'Szablony', heading: 'Szablony notatek' },
  ]

  for (const item of tools) {
    test(`otwiera widok „${item.label}”`, async ({ page }) => {
      await openTool(page, item.label)
      await expect(page.getByRole('heading', { name: item.heading, exact: true })).toBeVisible()
    })
  }

  test('przełącza dostępne widoki zadań', async ({ page }) => {
    await openTool(page, 'Zadania')
    const switcher = page.getByRole('group', { name: 'Widok zadań' })
    for (const view of ['Kanban', 'Kalendarz', 'Oś czasu', 'Tydzień', 'Szablony', 'Lista']) {
      await switcher.getByRole('button', { name: view }).click()
      await expect(switcher.getByRole('button', { name: view })).toHaveClass(/active/)
    }
  })

  test('otwiera ustawienia lokalnego modelu z menu Ollama', async ({ page }) => {
    await page.locator('details.topbar-dropdown-right > summary').click()
    await page.getByRole('group', { name: 'Ollama i operacje na paczce' }).getByRole('button', { name: 'Ustawienia modelu' }).click()
    await expect(page.getByRole('dialog', { name: 'Lokalny model Ollama' })).toBeVisible()
    await expect(page.getByLabel('Adres serwera')).toHaveValue('http://localhost:11434')
    await page.getByRole('button', { name: 'Anuluj' }).click()
    await expect(page.getByRole('dialog', { name: 'Lokalny model Ollama' })).toHaveCount(0)
  })

  test('otwiera paletę poleceń i filtruje dostępne akcje', async ({ page }) => {
    await page.getByRole('button', { name: 'Otwórz paletę poleceń' }).click()
    const dialog = page.getByRole('dialog', { name: 'Paleta poleceń' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Szukaj polecenia' }).fill('Fiszki')
    await expect(dialog).toContainText('Fiszki')
    await expect(dialog).not.toContainText('Pulpit projektów')
  })
})

test.describe('Fiszki', () => {
  async function openFlashcards(page: Page) {
    await openTool(page, 'Fiszki')
    await expect(page.getByRole('heading', { name: 'Fiszki', exact: true })).toBeVisible()
  }

  async function createCard(page: Page, question: string, answer: string) {
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click()
    await page.getByRole('textbox', { name: 'Pytanie' }).fill(question)
    await page.getByRole('textbox', { name: 'Odpowiedź' }).fill(answer)
    await page.getByRole('button', { name: 'Dodaj fiszkę' }).click()
    await expect(page.getByRole('button', { name: /Karty/ })).toBeVisible()
  }

  test('dodaje kartę i zachowuje ją po przejściu do listy oraz odświeżeniu', async ({ page }) => {
    await openFlashcards(page)
    await createCard(page, 'Pytanie testowe Playwright', 'Odpowiedź testowa')
    await page.getByRole('button', { name: /Karty/ }).click()
    await expect(page.locator('.flashcard-list')).toContainText('Pytanie testowe Playwright')
    await expect(page.locator('.flashcard-list')).toContainText('Osobiste / Witaj w No-Tie')
    await page.reload()
    await openFlashcards(page)
    await page.getByRole('button', { name: /Karty/ }).click()
    await expect(page.locator('.flashcard-list')).toContainText('Pytanie testowe Playwright')
  })

  test('wymaga treści pytania i odpowiedzi przed dodaniem prostej karty', async ({ page }) => {
    await openFlashcards(page)
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Dodaj fiszkę' })).toBeDisabled()
    await page.getByRole('textbox', { name: 'Pytanie' }).fill('Pytanie')
    await expect(page.getByRole('button', { name: 'Dodaj fiszkę' })).toBeDisabled()
    await page.getByRole('textbox', { name: 'Odpowiedź' }).fill('Odpowiedź')
    await expect(page.getByRole('button', { name: 'Dodaj fiszkę' })).toBeEnabled()
  })

  test('tryb wielokrotnego wyboru wymaga odpowiedzi i oznacza poprawną opcję', async ({ page }) => {
    await openFlashcards(page)
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click()
    await page.getByLabel('Typ nauki').selectOption('multiple-choice')
    await page.getByRole('textbox', { name: 'Pytanie' }).fill('Która odpowiedź jest poprawna?')
    await page.getByLabel('Treść odpowiedzi 1').fill('Prawidłowa')
    await page.getByLabel('Treść odpowiedzi 2').fill('Błędna')
    await page.getByLabel('Treść odpowiedzi 3').fill('Trzecia opcja')
    await page.getByLabel('Treść odpowiedzi 4').fill('Czwarta opcja')
    await page.getByLabel('Odpowiedź 2 jest poprawna').check()
    await expect(page.getByRole('button', { name: 'Dodaj fiszkę' })).toBeEnabled()
  })

  test('tryb prawda/fałsz nie wymaga tekstowego pola odpowiedzi', async ({ page }) => {
    await openFlashcards(page)
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click()
    await page.getByLabel('Typ nauki').selectOption('true-false')
    await page.getByRole('textbox', { name: 'Pytanie' }).fill('Woda wrze w 100°C przy ciśnieniu atmosferycznym.')
    await expect(page.getByText('Poprawna ocena stwierdzenia')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Odpowiedź' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Dodaj fiszkę' })).toBeEnabled()
  })

  test('zmienia liczbę kart na stronie w zakresie 10, 25, 50 i 100', async ({ page }) => {
    await openFlashcards(page)
    await page.getByRole('button', { name: /Karty/ }).click()
    const pageSize = page.getByLabel('Liczba fiszek na stronę')
    for (const size of ['10', '25', '50', '100']) {
      await pageSize.selectOption(size)
      await expect(pageSize).toHaveValue(size)
    }
  })

  test('pokazuje pusty stan postępów zanim powstanie talia', async ({ page }) => {
    await openFlashcards(page)
    await page.getByRole('button', { name: 'Postępy' }).click()
    await expect(page.getByRole('region', { name: 'Postępy i planowanie' })).toContainText('Najpierw utwórz talię')
  })
})

test.describe('Tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true })

  test('menu narzędzi otwiera się i pozwala przejść do biblioteki notatek', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Otwórz menu folderów i narzędzi' })).toBeVisible()
    await openAllNotes(page)
    await expect(page.locator('.all-notes-card')).toHaveCount(3)
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(element => element.clientWidth))
  })

  test('strona fiszek pozostaje dostępna na ekranie tabletu', async ({ page }) => {
    await openTool(page, 'Fiszki')
    await expect(page.getByRole('heading', { name: 'Fiszki', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Widoki fiszek' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
