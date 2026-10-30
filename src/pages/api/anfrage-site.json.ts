// Запасной адрес для public/api/anfrage.php: e-mail из _global.json (группа contact) и домен сайта.
// Только публичные данные, поэтому JSON рядом со скриптом, а не PHP — значение из админки не станет кодом.
import type { APIRoute } from 'astro';
import { SITE } from '../../config/site';

export const GET: APIRoute = ({ site }) => new Response(JSON.stringify({
  email: SITE.email,
  domain: (site?.hostname ?? '').replace(/^www\./, ''),
}));
