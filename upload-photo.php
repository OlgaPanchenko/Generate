<?php
// Простой сервисный скрипт для загрузки фото игроков.
// Кладёт файл в content/photo/<ник>.png — именно так его ищет PLASKI.html
// (background-image: url("content/photo/НИК.png")).
//
// Установка: залейте этот файл по FTP/панели Hoster.by в ту же папку, где
// лежат 1.html, 2.html, S2.html, PLASKI.html (рядом с папкой content/).
// Замените пароль ниже на свой — это простая защита, чтобы грузить фото
// мог только тот, кто знает пароль, а не любой случайный посетитель.

header('Content-Type: application/json; charset=utf-8');

const UPLOAD_PASSWORD = 'mafia2026'; // <-- поменяйте на свой пароль

function respond($ok, $message) {
    echo json_encode(['ok' => $ok, 'message' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(false, 'Только POST-запросы');
}

if (($_POST['password'] ?? '') !== UPLOAD_PASSWORD) {
    respond(false, 'Неверный пароль');
}

$nick = trim($_POST['nick'] ?? '');
if ($nick === '') {
    respond(false, 'Не указан ник игрока');
}

// Защита от path traversal и опасных символов в имени файла.
$nick = preg_replace('/[\/\\\\\.\x00-\x1f]/u', '', $nick);
$nick = trim($nick);
if ($nick === '') {
    respond(false, 'Некорректный ник (после очистки стал пустым)');
}

if (!isset($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
    respond(false, 'Файл не получен (ошибка загрузки)');
}

$tmpPath = $_FILES['photo']['tmp_name'];
$size = $_FILES['photo']['size'];
if ($size > 8 * 1024 * 1024) {
    respond(false, 'Файл слишком большой (максимум 8 МБ)');
}

$info = @getimagesize($tmpPath);
if ($info === false) {
    respond(false, 'Файл не похож на изображение');
}

$destDir = __DIR__ . '/content/photo';
if (!is_dir($destDir)) {
    @mkdir($destDir, 0755, true);
}
$destPath = $destDir . '/' . $nick . '.png';

$saved = false;

// Пытаемся перекодировать в PNG через GD — так итоговый файл всегда будет
// .png независимо от исходного формата (jpg/webp/gif и т.п.).
if (function_exists('imagecreatefromstring')) {
    $data = @file_get_contents($tmpPath);
    $img = ($data !== false) ? @imagecreatefromstring($data) : false;
    if ($img !== false) {
        imagesavealpha($img, true);
        $saved = @imagepng($img, $destPath);
        imagedestroy($img);
    }
}

// Если GD недоступен или не справился — просто копируем файл как есть.
if (!$saved) {
    $saved = @copy($tmpPath, $destPath);
}

if (!$saved) {
    respond(false, 'Не удалось сохранить файл на сервере (проверьте права на папку content/photo)');
}

respond(true, 'Фото сохранено: content/photo/' . $nick . '.png');
