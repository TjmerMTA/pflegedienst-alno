<?php
// Upload checks and re-encoding. Prefers GD; Hetzner offers ImageMagick as an optional extension, so
// Imagick is the fallback on a PHP without GD. The setup screen reports what the host has.
declare(strict_types=1);

final class UploadError extends RuntimeException {}

final class Media
{
    const MAX_BYTES = 10485760;

    public static function engine(): ?string
    {
        if (function_exists('imagecreatefromstring')) return 'gd';
        if (class_exists('Imagick')) return 'imagick';
        return null;
    }

    public static function supportsWebp(): bool
    {
        return self::engine() === 'gd' ? function_exists('imagewebp') && function_exists('imagecreatefromwebp') : self::engine() === 'imagick';
    }

    private static function isAnimatedWebp(string $bytes): bool
    {
        return strncmp($bytes, 'RIFF', 4) === 0 && strpos(substr($bytes, 12, 4096), 'ANIM') !== false;
    }

    /** Checks and re-encodes an upload. Returns [bytes, ext, width, height]. */
    public static function process(string $buf, int $maxBytes = self::MAX_BYTES): array
    {
        if ($buf === '') throw new UploadError('Leere Datei');
        if (strlen($buf) > $maxBytes) throw new UploadError('Datei zu groß (höchstens ' . (int) round($maxBytes / 1048576) . ' MB)');
        $head = strtolower(ltrim(substr($buf, 0, 512)));
        if (strncmp($head, '<svg', 4) === 0 || strncmp($head, '<?xml', 5) === 0 || strpos($head, '<svg') !== false) throw new UploadError('SVG ist nicht erlaubt');
        $type = Rules::sniffImage($buf);
        if ($type === null) throw new UploadError('Nur JPG, PNG oder WebP');
        if (class_exists('finfo')) {
            $mime = (new finfo(FILEINFO_MIME_TYPE))->buffer($buf);
            if ($mime !== "image/$type") throw new UploadError('Dateiinhalt passt nicht zum Bildformat');
        }
        if ($type === 'webp' && !self::supportsWebp()) throw new UploadError('WebP wird auf diesem Server nicht unterstützt. Bitte JPG oder PNG verwenden.');
        $info = @getimagesizefromstring($buf);
        if (!$info || !$info[0] || !$info[1]) throw new UploadError('Die Datei ist kein lesbares Bild');
        if ($info[0] * $info[1] > Rules::IMAGE_MAX_PIXELS) throw new UploadError('Das Bild hat zu viele Pixel');
        if ($type === 'webp' && self::isAnimatedWebp($buf)) throw new UploadError('Animierte Bilder sind nicht erlaubt');
        return self::engine() === 'imagick' ? self::encodeImagick($buf, $type) : self::encodeGd($buf, $type);
    }

    private static function orientation(string $buf, string $type): int
    {
        if ($type !== 'jpeg' || !function_exists('exif_read_data')) return 1;
        $exif = @exif_read_data('data://image/jpeg;base64,' . base64_encode($buf));
        return (int) ($exif['Orientation'] ?? 1);
    }

    private static function encodeGd(string $buf, string $type): array
    {
        $src = @imagecreatefromstring($buf);
        if (!$src) throw new UploadError('Die Datei ist kein lesbares Bild');
        switch (self::orientation($buf, $type)) {
            case 3: $src = imagerotate($src, 180, 0); break;
            case 6: $src = imagerotate($src, -90, 0); break;
            case 8: $src = imagerotate($src, 90, 0); break;
        }
        $w = imagesx($src);
        $h = imagesy($src);
        $scale = min(1, Rules::IMAGE_MAX_SIDE / max($w, $h));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $dst = imagecreatetruecolor($nw, $nh);
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
        ob_start();
        $ok = $type === 'jpeg' ? imagejpeg($dst, null, 84) : ($type === 'png' ? imagepng($dst, null, 9) : imagewebp($dst, null, 84));
        $out = (string) ob_get_clean();
        if (!$ok || $out === '') throw new UploadError('Das Bild konnte nicht verarbeitet werden');
        return [$out, $type === 'jpeg' ? 'jpg' : $type, $nw, $nh];
    }

    private static function encodeImagick(string $buf, string $type): array
    {
        try {
            $im = new Imagick();
            $im->setResourceLimit(Imagick::RESOURCETYPE_MEMORY, 180 * 1048576);
            $im->readImageBlob($buf);
            if ($im->getNumberImages() > 1) throw new UploadError('Animierte Bilder sind nicht erlaubt');
            $im->autoOrient();
            $w = $im->getImageWidth();
            $h = $im->getImageHeight();
            if (max($w, $h) > Rules::IMAGE_MAX_SIDE) $im->thumbnailImage(Rules::IMAGE_MAX_SIDE, Rules::IMAGE_MAX_SIDE, true);
            $im->stripImage();
            $im->setImageCompressionQuality(84);
            return [$im->getImageBlob(), $type === 'jpeg' ? 'jpg' : $type, $im->getImageWidth(), $im->getImageHeight()];
        } catch (ImagickException $e) {
            throw new UploadError('Das Bild konnte nicht verarbeitet werden');
        }
    }

    public static function randomName(string $ext): string
    {
        return bin2hex(random_bytes(8)) . ".$ext";
    }

    /** Small square preview for the grid, cached by content. */
    public static function thumbnail(string $bytes, Store $store): ?string
    {
        $key = 'cache/thumbs/' . sha1($bytes) . '.jpg';
        $cached = $store->read($key);
        if ($cached !== null) return $cached;
        if (self::engine() !== 'gd') return null;
        $src = @imagecreatefromstring($bytes);
        if (!$src) return null;
        $w = imagesx($src);
        $h = imagesy($src);
        $side = min($w, $h);
        $dst = imagecreatetruecolor(360, 360);
        imagefill($dst, 0, 0, (int) imagecolorallocate($dst, 240, 240, 241));
        imagecopyresampled($dst, $src, 0, 0, (int) (($w - $side) / 2), (int) (($h - $side) / 2), 360, 360, $side, $side);
        ob_start();
        imagejpeg($dst, null, 72);
        $out = (string) ob_get_clean();
        $store->write($key, $out);
        return $out;
    }
}
