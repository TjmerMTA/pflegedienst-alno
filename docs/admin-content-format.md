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

## 5. How to migrate a page

Done so far: `index`, `ueber-uns`, `karriere`, `ausbildung`, `kontakt`, `erstbegutachtung`, `404` and `_global`
(Header, Footer, MobileBar, Consent, CtaBand, Certificates, Testimonials, ServiceArea, FAQ, contact data, both
forms). Copy them: `src/content/pages/index.json` + `src/pages/index.astro`; `src/pages/kontakt.astro` for a page
with `PageHero`.
The goal of every migration: **the built HTML stays byte for byte the same**.

### Steps

1. **Baseline first**, before touching anything:
   `npm run build && rm -rf /tmp/dist-before && cp -R dist /tmp/dist-before`
   (if the page has parts that only exist with Google Analytics, also keep a build made with
   `PUBLIC_GA_ID=G-TEST npm run build`).
2. **Write `src/content/pages/<id>.json`**: `label` (German menu name), `url`, `order`; one group per
   on-page section, in page order; German labels; `help` where the editor needs to know where the rest
   comes from (e.g. "Titel und Kurztexte der Karten kommen aus den Leistungen"). Format it like
   `JSON.stringify(data, null, 2)` + trailing newline, UTF-8, no `\u` escapes — the admin writes that format back.
3. **In the page**: get `getPage` without changing the number of imports (trap 2 below), `const p = getPage('<id>');`,
   then replace each literal text with `{p.text('group.field')}`, the SEO props with `title={p.text('seo.title')}` /
   `description={p.text('seo.description')}`, the `PageHero` props with `title`, `lead` and
   `crumbs={[{ label: p.text('hero.crumb') }]}` (see `hero` in any page file), and each image import with
   `const img = p.img('group.image')!` → `<Image src={img.src} alt={img.alt} … />`.
   Do not name loop variables `p` (the blog loop in `index.astro` became `post`).
4. **Build and diff**: `npm run build && diff -r /tmp/dist-before dist` must print nothing. Then change one
   value in the JSON and see it in `dist`, and rename one field id and see the build fail with `[content] …`.

### What goes where

- **Data**: every visible text, every content image and its alt, the SEO title/description.
- **Code**: hrefs, classes, icons that are fixed in the layout, aria-labels, scripts, styles, the logo.
- **Sentence with a link or `<b>` inside**: split into `…Before` / `…After` text fields, the tag stays in the
  markup: `{p.text('callback.visitBefore')} <a href={SITE.phoneHref}>{SITE.phone}</a> {p.text('callback.visitAfter')}`.
  Not a richtext: the editor could break the markup around it, and in a component with a `<style>` block every
  literal tag carries `data-astro-cid-…`, which richtext cannot reproduce (`ausbildung` `training.textBold`).
  Richtext is for whole blocks rendered with `set:html`, like the FAQ answers.
- **Repeated blocks** (cards, steps, check marks) → `list`. An icon per item → sub-field `icon` (type `text`,
  the `help` lists the names); an unknown name shows the `info` icon, it never breaks the build.
  Numbers like 1-2-3 are computed (`{i + 1}`), not stored. Lists cannot nest: several short values inside an
  item → a `textarea` sub-field, one value per line, split in the page (`karriere` `jobs.items[].tags`).
- **Values that must match each other** have one source: the form's options are read from the page's list
  (`ApplicationForm` takes its positions from `karriere` `jobs.items`, its `wunsch` radios from `ausbildung`
  `ways.items`), so `data-position` / `data-wunsch` can never drift from them.
- **Texts in browser `<script>`s** (form messages, the map title) cannot use `content.ts`, and a `data-` attribute
  would change the HTML. They are substituted at build time: add the value in `src/lib/client-texts.mjs` (keeps
  tokens, fails with `[content] …`), then use the constant in the script (`declare const __NAME__: string;`). The
  minifier sees the literal as before, so the bytes stay. In `astro dev` the values are read once: restart after a
  JSON edit.
- **Fixed slots bound to code** (menu items with their hrefs, the four map areas) → separate fields or
  groups, not a list: the admin may add and remove list items, and the code would have no href/shape for them.
- **Contact values inside texts** → tokens, only where the text is exactly that value:
  `{{phone}}`, `{{email}}`, `{{street}}`, `{{name}}`, `{{hours}}` (8–22 Uhr), `{{officeHours}}` (Mo–Fr 8–16 Uhr).
  Phone numbers in markup keep using `SITE.phone` / `SITE.phoneHref` (from `src/config/site.ts`).
- **Shared blocks** (used on several pages) go to `_global.json`, page-specific headings around them stay
  in the page file (e.g. `testimonials.h2` is in `index.json`, the testimonials themselves in `_global.json`).

### Helper details (`src/lib/content.ts`)

- `text()` — `text`/`textarea` fields; `html()` — `richtext` fields, sanitised; `img()` — `{ src, alt }`, or
  `null` when an optional image is empty; `list()` — items with `text`/`textarea` values tokens replaced and
  `richtext` values sanitised. Image sub-fields inside a list are not supported yet (section 1 does not say
  where their alt lives) and fail the build with a clear message.
- `textHtml()` — a `text`/`textarea` value as HTML for `set:html`, escaped the way literal markup text is
  (see the next point). `escText(value)` does the same for a value from `list()`.
- Missing file, group or field, a wrong type, an empty `required` value, an image that is not in
  `src/assets/img/` → the build fails with `[content] <file>: …`. An unknown `{{token}}` only warns and stays
  as typed (the admin can save it, so the site must still build).

### Byte-identity traps (each one cost a diff)

1. **`{expr}` escapes `& ' " < >`, literal markup text does not.** `Kosten & Finanzierung` written in the
   markup comes out as `&`, `{p.text(…)}` as `&amp;`. Where the old literal text had `&`, `'` or `"`, render
   with `set:html={p.textHtml('…')}` on the element (`<h2 class="h3" set:html={p.textHtml('…')} />`) or
   `<Fragment set:html={p.textHtml('…')} />` next to an icon; in a list item, `<b set:html={escText(e.title)} />`.
   Texts that already were props or expressions (`<PageHero title="…">`, `{n.label}`) were escaped before too, and
   so was literal `&amp;` in the source — keep `p.text()` there.
2. **A new `import` in an `.astro` file can reorder the `<style>` blocks** of every page that uses it: Astro
   sorts inlined CSS by import position (`cssOrder` in `astro/dist/core/build/runtime.js`), so a file must keep
   the same number of static imports in the same order:
   - a page or component that already imports `../config/site` takes the helpers from there, no new import:
     `import { SITE, getPage, getGlobal, escText } from '../config/site'`;
   - a page that loses image imports puts `import { getPage } from '../lib/content'` in the place of the first
     one, and pads the rest with a bare `import '../config/site';` (`ueber-uns.astro`: two images, two imports);
   - a component that imports nothing from config uses `const { getGlobal } = await import('../lib/content');`
     (a dynamic import does not count) — see `Certificates.astro`, `PageHero.astro`.
3. **Identical image files under different names**: the library glob imports all of `src/assets/img/`, and the
   bundler emits identical bytes once, under whichever name it meets first. `team.jpg` (a copy of
   `blog-antrag.jpg`) renamed the blog image in the output and was removed. If `_astro/` file names change,
   compare the images with `md5`.
4. **Whitespace** between elements is dropped by the compiler, so a static `<li>…</li><li>…</li>` and a
   `.map()` produce the same bytes — no need to imitate the old line breaks.
