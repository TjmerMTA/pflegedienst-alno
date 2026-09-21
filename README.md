# Pflegedienst ALNO GmbH — сайт

Превью: https://dev.siteboosty.com (закрыто от индексации: `robots.txt` Disallow + `noindex`).

## Стек и почему

- **Astro 7** — статический сайт: максимальная скорость (0 КБ JS на страницах, кроме форм/меню), идеальный Core Web Vitals, никаких обновлений плагинов и уязвимостей, как у WordPress.
- **Контент в Markdown** (`src/content/blog`, `src/content/leistungen`) — новая статья = новый файл, страница, sitemap и разметка генерируются сами.
- **Pages CMS** (`.pages.yml`) — визуальный редактор для клиента: https://app.pagescms.org → вход через GitHub → репозиторий → «Ratgeber». Сохранение = коммит → автосборка.
- **Хостинг**: GitHub Pages (превью). Для продакшна — то же или Cloudflare Pages, домен клиента.

## Команды

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # → dist/
npm run preview
./deploy.sh       # сборка + выкладка в ветку gh-pages
```

Автосборку через GitHub Actions можно включить, переложив `docs/deploy-workflow.yml.example` в `.github/workflows/deploy.yml` (нужен токен с правом `workflow`) и переключив Pages на «GitHub Actions».

## Настройки

| Что | Где |
|---|---|
| Адрес, телефоны, WhatsApp, районы | `src/config/site.ts` |
| FAQ | `src/config/faq.ts` |
| Обработчик форм (Web3Forms / Formspree) | переменная `PUBLIC_FORM_ENDPOINT` (GitHub → Settings → Variables) |
| Google Analytics 4 | переменная `PUBLIC_GA_ID` — баннер согласия включится сам, до согласия GA не грузится |
| Продакшн-домен | `SITE_URL` в `deploy.sh` + `public/CNAME` |

Если `SITE_URL` не содержит `siteboosty` — сайт автоматически открывается для индексации и `robots.txt` отдаёт sitemap.

## Как добавить статью вручную

Создать `src/content/blog/<adresse-der-seite>.md`:

```md
---
title: "Заголовок (H1 и Meta Title)"
description: "Meta Description до 170 символов"
date: 2026-10-01
image: ../../assets/img/bild.jpg
imageAlt: "Описание картинки"
---

## Подзаголовок H2
Текст…
```

Имя файла = URL (`/blog/adresse-der-seite/`). `draft: true` — статья не публикуется.

## SEO

Title/Description на каждой странице, canonical, Open Graph, Schema.org (`LocalBusiness`+`MedicalBusiness`, `Service`, `BlogPosting`, `FAQPage`, `BreadcrumbList`), `sitemap-index.xml`, `robots.txt`, оптимизация картинок в WebP, локальные шрифты (DSGVO).

## Что нужно от клиента до запуска (TODO в коде)

- Мобильный номер для WhatsApp (`site.ts`)
- Реальные фото команды, имена, квалификации
- Реальные отзывы (или подключение Google-отзывов)
- Сканы Zulassungen / сертификатов
- Подтверждение районов обслуживания и точных координат офиса
- Страховщик Berufshaftpflicht и WTG-Behörde для Impressum
- Юридическая проверка Datenschutzerklärung
