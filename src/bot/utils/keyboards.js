/**
 * Keyboard builders for Telegram bot UI.
 */

import { PERSONALITIES } from "../../personalities/index.js";

export const BUTTONS = {
    newChat: "🆕 New Chat",
    changePersonality: "⚙️ Change Personality",
    showMemory: "📝 Show Memory",
    imageSettings: "🖼️ Image Settings",
};

export const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: BUTTONS.newChat, callback_data: "new_chat" }],
            [
                {
                    text: BUTTONS.changePersonality,
                    callback_data: "configure_personality",
                },
            ],
            [{ text: BUTTONS.showMemory, callback_data: "show_memory" }],
            [
                {
                    text: BUTTONS.imageSettings,
                    callback_data: "show_image_settings",
                },
            ],
        ],
    },
};

export const quickKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: BUTTONS.newChat }],
            [{ text: BUTTONS.changePersonality }],
            [{ text: BUTTONS.showMemory }],
            [{ text: BUTTONS.imageSettings }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
    },
};

export function buildPersonalityMenu() {
    const inline = Object.entries(PERSONALITIES)
        .map(([key, value]) => [
            {
                text: `${value.name}`,
                callback_data: `set_personality_${key}`,
            },
        ]);

    return {
        reply_markup: {
            inline_keyboard: inline,
        },
    };
}

export function buildMemoryKeyboard(memoryEntries) {
    const rows = memoryEntries.map((entry, idx) => [
        {
            text: `✏️ Edit ${idx + 1}`,
            callback_data: `memory_edit_${entry.id}`,
        },
        {
            text: `🗑️ Delete ${idx + 1}`,
            callback_data: `memory_delete_${entry.id}`,
        },
    ]);

    if (rows.length > 0) {
        rows.push([{ text: "🔄 Refresh", callback_data: "show_memory" }]);
    }

    return {
        reply_markup: {
            inline_keyboard: rows,
        },
    };
}

export function imageSettingsMessage(enabled, available = true) {
    if (!available) {
        return "🖼️ Automatic images are unavailable in the current application configuration.";
    }
    return `🖼️ Automatic image after each reply: ${enabled ? "Enabled" : "Disabled"}\n\nThis preference belongs to your Telegram account and applies to every personality.`;
}

export function buildImageSettingsKeyboard(enabled, available = true) {
    const rows = [];
    if (available) {
        rows.push([
            {
                text: enabled ? "✅ Images enabled" : "Enable images",
                callback_data: "image_generation_enable",
            },
            {
                text: enabled ? "Disable images" : "⛔ Images disabled",
                callback_data: "image_generation_disable",
            },
        ]);
    }
    return { reply_markup: { inline_keyboard: rows } };
}
