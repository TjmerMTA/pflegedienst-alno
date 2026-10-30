# Admin content format (contract between the site and the admin)

Every visible text and every content image of the site lives in data files, not in `.astro` markup.
The site reads them at build time; the admin (`admin/`) edits only the **values** in them.

## 1. Page files — `src/content/pages/<id>.json`

One file per page (`index`, `ueber-uns`, `karriere`, …) plus `_global.json` for what is shared by
all pages (contact data, opening hours, header, footer, cookie banner, CTA band, FAQ, …).

```json
{
  "label": "Startseite",
  "url": "/",
  "order": 1,
  "groups": [
    {
      "id": "seo",
      "label": "SEO: Titel und Beschreibung",
      "fields": [
        { "id": "title", "label": "Meta Title", "type": "text", "max": 70, "required": true, "value": "Ambulanter Pflegedienst in Dortmund | Pflegedienst ALNO GmbH" },
        { "id": "description", "label": "Meta Description", "type": "textarea", "max": 170, "required": true, "value": "…" }
      ]
    },
    {
      "id": "hero",
      "label": "Erster Bildschirm",
      "fields": [
        { "id": "pill", "label": "Kleiner Hinweis über der Überschrift", "type": "text", "value": "Ambulante Pflege in Dortmund" },
        { "id": "h1", "label": "Überschrift (H1)", "type": "text", "max": 90, "required": true, "value": "Gut versorgt zu Hause –" },
        { "id": "h1Highlight", "label": "Farbig hervorgehobener Teil", "type": "text", "value": "mit Herz und Fachwissen" },
        { "id": "lead", "label": "Einleitungstext", "type": "richtext", "value": "<p>Wir pflegen …</p>" },
        { "id": "image", "label": "Bild", "type": "image", "value": "startseite-hero.jpg", "alt": "Pflegekraft umarmt eine lächelnde Seniorin" },
        { "id": "trust", "label": "Vertrauenspunkte", "type": "list", "itemLabel": "Punkt", "min": 1, "max": 6,
          "fields": [ { "id": "text", "label": "Text", "type": "text" } ],
          "value": [ { "text": "Alle Kassen" }, { "text": "Telefon {{hours}}" } ] }
      ]
    }
  ]
}
```

- `label`, `url` (`null` for `_global`), `order` — how the page is shown in the admin menu.
- `groups[]` — boxes in the admin ("metaboxes"), in the order they appear on the page.
- `fields[]` — `id` (unique inside its group), `label` (German, shown in the admin), `type`,
  `value`, optional `help` (hint under the field), `required`, `max` (characters, for text/textarea).

### Field types

| type       | value                                                   | notes |
|------------|---------------------------------------------------------|-------|
| `text`     | string, one line                                        | no HTML |
| `textarea` | string, may contain `\n`                                | no HTML; site shows `\n` as line break only where the markup already allowed it |
| `richtext` | HTML string                                             | allowed tags only: `p br strong b em i a[href] ul ol li h2 h3`; anything else is stripped by the admin on save and by the site on render |
| `image`    | path relative to `src/assets/img/` (e.g. `team.jpg`, `uploads/ab12cd.jpg`) | extra key `"alt"` (required, string) |
| `list`     | array of objects keyed by the sub-field ids in `fields` | `itemLabel`, `min`, `max`; sub-fields use the same types except `list` |

### Tokens

Any `text`/`textarea`/`richtext` value may contain `{{key}}`; the site replaces it with the value of
field `key` in group `contact` of `_global.json` (e.g. `{{phone}}`, `{{email}}`, `{{hours}}`,
`{{officeHours}}`). So a phone number changed once in the admin changes on every page.

### Ownership

- **Structure** (files, group/field ids, types, labels, min/max) is owned by the code. The admin
  never adds or removes groups or fields and never changes ids, types or labels.
- **Values** are owned by the admin. For `list` fields the admin may add, remove and reorder items
  within `min`/`max`.
- The site must build with any value the admin can produce (empty optional fields included).

## 2. Collections — unchanged Markdown

`src/content/blog/*.md`, `src/content/leistungen/*.md`, `src/content/team/*.md`: frontmatter as in
`src/content.config.ts`, body in Markdown. The admin edits frontmatter and body; it may create and
delete blog posts and team members, and edit (not create/delete) Leistungen. Image fields in
frontmatter use a path relative to the `.md` file (`../../assets/img/…`).

## 3. Images

- Library = every `jpg/jpeg/png/webp` under `src/assets/img/`.
- Uploads go to `src/assets/img/uploads/<random>.<ext>`: type checked by content, re-encoded
  (sharp), longest side at most 2400 px, never the uploaded file name, never SVG.
- The site loads images through `import.meta.glob('/src/assets/img/**/*.{jpg,jpeg,png,webp}')`, so
  `<Image>` keeps its optimisation.

## 4. Site helper — `src/lib/content.ts`

```ts
const p = getPage('index');      // throws at build time if the file or a field is missing
p.text('hero.h1')                // string, tokens replaced
p.html('hero.lead')              // sanitised HTML for set:html, tokens replaced
p.img('hero.image')              // { src: ImageMetadata, alt: string }
p.list('hero.trust')             // array of item objects (their text values tokens replaced)
getGlobal()                      // same API for _global.json
```
