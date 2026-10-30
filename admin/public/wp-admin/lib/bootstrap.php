<?php
declare(strict_types=1);

ini_set('display_errors', '0');
date_default_timezone_set('Europe/Berlin');
foreach (['Rules', 'Frontmatter', 'Store', 'GitHub', 'Auth', 'Site', 'Media', 'Anfragen', 'Api'] as $class) require_once __DIR__ . "/$class.php";
