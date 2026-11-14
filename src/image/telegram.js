export const IMAGE_BUILDING_MESSAGE = "🎨 Your image is being created...";

const TELEGRAM_PHOTO_CAPTION_MAX_LENGTH = 1024;
const IMAGE_CAPTION_PREFIX = "📝 Image direction\n<blockquote expandable>";
const IMAGE_CAPTION_SUFFIX = "</blockquote>";

export function escapeTelegramHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

export function buildImageCaption(scenePrompt) {
    const escapedPrompt = escapeTelegramHtml(scenePrompt);
    const availableLength =
        TELEGRAM_PHOTO_CAPTION_MAX_LENGTH -
        IMAGE_CAPTION_PREFIX.length -
        IMAGE_CAPTION_SUFFIX.length;

    if (escapedPrompt.length <= availableLength) {
        return `${IMAGE_CAPTION_PREFIX}${escapedPrompt}${IMAGE_CAPTION_SUFFIX}`;
    }

    const ellipsis = "…";
    const previewLimit = availableLength - ellipsis.length;
    let preview = "";
    for (const character of String(scenePrompt)) {
        const escapedCharacter = escapeTelegramHtml(character);
        if (preview.length + escapedCharacter.length > previewLimit) break;
        preview += escapedCharacter;
    }

    return `${IMAGE_CAPTION_PREFIX}${preview}${ellipsis}${IMAGE_CAPTION_SUFFIX}`;
}

export function imageGenerationErrorMessage() {
    return "⚠️ I couldn't create the image this time. Your text reply is safe; please try again with the next message.";
}

