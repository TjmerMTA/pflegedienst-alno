<?php
// Front door of the admin's server. Everything else in this folder is static or denied by .htaccess.
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';
(new Api())->run();
