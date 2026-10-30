// Для public/api/anfrage.php: правила форм, запасной e-mail из _global.json (группа contact) и домен сайта.
// Только публичные данные, поэтому JSON рядом со скриптом, а не PHP — значение из админки не станет кодом.
import type { APIRoute } from 'astro';
import { SITE, FORM_RULES } from '../../config/site';

export const GET: APIRoute = ({ site }) => new Response(JSON.stringify({
  email: SITE.email,
  domain: (site?.hostname ?? '').replace(/^www\./, ''),
  rules: FORM_RULES,
}));
